'use strict';
var fs=require('fs'),path=require('path'),crypto=require('crypto');
var TTL=12*60*60*1000,COOKIE='vetro_session';
function digest(value){return crypto.createHash('sha256').update(value).digest('hex');}
function derive(password,salt){return new Promise(function(resolve,reject){crypto.scrypt(password,Buffer.from(salt,'hex'),64,{N:16384,r:8,p:1,maxmem:64*1024*1024},function(e,key){if(e)reject(e);else resolve(key);});});}
function token(req){var match=/(?:^|;\s*)vetro_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers&&req.headers.cookie||'');return match&&match[1];}
function Auth(options){
 this.file=options.file;this.record=null;this.error=null;this.busy=false;this.pending=0;this.attempts=new Map();
 try{
  if(fs.statSync(this.file).size>32768)throw Error('Authentication settings too large');
  var r=JSON.parse(fs.readFileSync(this.file,'utf8'));
  if(r.schema!==1||!/^[a-f0-9]{64}$/.test(r.salt)||!/^[a-f0-9]{128}$/.test(r.hash)||!Array.isArray(r.sessions)||r.sessions.length>64||r.sessions.some(function(s){return !s||!/^[a-f0-9]{64}$/.test(s.digest)||!Number.isFinite(s.expiresAt);}))throw Error('Invalid authentication settings');
  this.record=r;
 }catch(e){if(e.code!=='ENOENT')this.error='Password settings could not be read. Access is locked until the settings are repaired.';}
}
Auth.prototype.enabled=function(){return !!(this.record||this.error);};
Auth.prototype.authenticated=function(req){
 if(this.error)return false;
 if(!this.record)return true;
 var t=token(req);if(!t)return false;var hash=digest(t),now=Date.now();
 return this.record.sessions.some(function(s){return s.expiresAt>now&&crypto.timingSafeEqual(Buffer.from(s.digest,'hex'),Buffer.from(hash,'hex'));});
};
Auth.prototype.status=function(req){return {enabled:this.enabled(),authenticated:this.authenticated(req),error:this.error};};
Auth.prototype.save=function(record){
 var dir=path.dirname(this.file),temporary=this.file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp',fd;
 try{
  fs.mkdirSync(dir,{recursive:true,mode:0o700});fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.renameSync(temporary,this.file);this.record=record;
  fd=fs.openSync(dir,'r');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(_){} }
};
Auth.prototype.cookie=function(res,value){res.setHeader('Set-Cookie',COOKIE+'='+value+'; Path=/; HttpOnly; SameSite=Strict'+(value?'':'; Max-Age=0'));};
Auth.prototype.issue=function(res,record){
 var t=crypto.randomBytes(32).toString('hex');
 var sessions=record.sessions.filter(function(s){return s.expiresAt>Date.now();}).slice(-63);
 sessions.push({digest:digest(t),expiresAt:Date.now()+TTL});
 this.save(Object.assign({},record,{sessions:sessions}));this.cookie(res,t);
};
Auth.prototype.setPassword=async function(req,res,password){
 if(this.error)throw Object.assign(Error(this.error),{statusCode:503});
 if(!this.authenticated(req))throw Object.assign(Error('Sign in before changing the password'),{statusCode:401});
 if(this.busy)throw Object.assign(Error('Password change already in progress'),{statusCode:409});
 if(typeof password!=='string'||password.length<8||password.length>256)throw Object.assign(Error('Use a password between 8 and 256 characters'),{statusCode:400});
 this.busy=true;
 try{
  var salt=crypto.randomBytes(32).toString('hex'),key=await derive(password,salt);
  // A single atomic write both changes the hash and revokes every previous session.
  this.issue(res,{schema:1,salt:salt,hash:key.toString('hex'),sessions:[]});
  this.attempts.clear();
 }finally{this.busy=false;}
};
Auth.prototype.login=async function(req,res,password){
 if(this.error)throw Object.assign(Error(this.error),{statusCode:503});
 if(!this.record)throw Object.assign(Error('No dashboard password is configured'),{statusCode:409});
 var ip=req.socket&&req.socket.remoteAddress||'unknown',now=Date.now(),a=this.attempts.get(ip)||{failures:0,until:0,last:now};
 if(now-a.last>10*60*1000)a={failures:0,until:0,last:now};
 if(a.until>now||this.pending>=2)throw Object.assign(Error('Too many attempts. Wait before trying again.'),{statusCode:429});
 if(typeof password!=='string'||password.length>256)throw Object.assign(Error('Incorrect password'),{statusCode:401});
 if(this.attempts.size>=256&&!this.attempts.has(ip))this.attempts.delete(this.attempts.keys().next().value);
 this.attempts.set(ip,a);this.pending++;
 try{
  var before=this.record,key=await derive(password,before.salt);
  if(this.record.salt!==before.salt||!crypto.timingSafeEqual(key,Buffer.from(before.hash,'hex'))){
   a.failures++;a.last=Date.now();if(a.failures>=5)a.until=Date.now()+Math.min(300000,30000*Math.pow(2,a.failures-5));
   throw Object.assign(Error('Incorrect password'),{statusCode:401});
  }
  this.issue(res,this.record);this.attempts.delete(ip);
 }finally{this.pending--;}
};
Auth.prototype.logout=function(req,res){
 if(this.record){var t=token(req);if(t)this.save(Object.assign({},this.record,{sessions:this.record.sessions.filter(function(s){return s.digest!==digest(t)&&s.expiresAt>Date.now();})}));}
 this.cookie(res,'');
};
module.exports={Auth:Auth};
