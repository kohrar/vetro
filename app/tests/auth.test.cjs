'use strict';
const assert=require('assert').strict,fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
const {Auth}=require('../service/auth');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vetro-auth-test-')),file=path.join(directory,'auth.json');
const service=require('./service-harness.cjs')(path.resolve(__dirname,'..'));
let auth=new Auth({file});service.context.auth=auth;
const server=http.createServer(service.router);
function request(method,url,data,cookie,headers={}){return new Promise((resolve,reject)=>{
 const body=data===undefined?'':JSON.stringify(data);
 const req=http.request({host:'127.0.0.1',port:server.address().port,path:url,method,headers:Object.assign({'content-type':'application/json'},cookie?{cookie}:null,headers)},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end(body);
});}
function cookie(r){return r.headers['set-cookie'][0].split(';')[0];}
const password='Example password 123';
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 assert.equal((await request('GET','/')).status,200,'first setup stays accessible before a password is chosen');
 assert.equal((await request('POST','/auth/password',{password:'short'})).status,400);
 assert.equal((await request('POST','/auth/password',{password},null,{origin:'http://evil.test'})).status,403);
 assert.equal((await request('POST','/auth/password',{password},null,{'content-type':'text/plain'})).status,415);
 let setup=await request('POST','/auth/password',{password});assert.equal(setup.status,200);const first=cookie(setup);
 assert.match(setup.headers['set-cookie'][0],/HttpOnly; SameSite=Strict/);assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.ok(!fs.readFileSync(file,'utf8').includes(password));assert.ok(!fs.readFileSync(file,'utf8').includes(first.split('=')[1]),'only session digests persist');
 const blocked=await request('GET','/');assert.equal(blocked.status,303);assert.equal(blocked.headers.location,'/login');assert.ok(!blocked.body.includes('Quick settings'));
 const login=await request('GET','/login');assert.equal(login.status,200);assert.ok(!login.body.includes('id="quick"'));assert.match(login.headers['cache-control'],/no-store/);
 const endpoints=['/dock','/dock/icon?slug=settings','/wins','/exec','/installer','/diagnostics/download','/apps','/mqtt','/probe','/telemetry','/settings','/tv-settings','/unknown'];
 for(const u of endpoints){assert.equal((await request('GET',u)).status,401,u);if(u!=='/probe')assert.equal((await request('POST',u,{})).status,401,u);}
 // Only the TV-local widget exchange can bypass authentication. A LAN client cannot spoof it.
 assert.equal((await request('GET','/status')).status,200,'loopback widget status survives authentication');
 function remote(method,url,cookie,headers={}){return new Promise(resolve=>{const r={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(code,h){this.status=code;Object.assign(this.headers,h);},end(body){resolve({status:this.status,body});}};service.router({method,url,headers:Object.assign(cookie?{cookie}:{},headers),socket:{remoteAddress:'192.0.2.25'},resume(){},on(){}},r);});}
 assert.equal((await remote('GET','/status')).status,401);assert.equal((await remote('POST','/probe')).status,401);
 assert.equal((await remote('GET','/status',null,{'x-forwarded-for':'127.0.0.1',origin:'null'})).status,401);
 assert.equal((await request('GET','/',undefined,first)).status,200);
 assert.equal((await request('POST','/auth/password',{password:'new password 456'})).status,401);
 for(let n=0;n<5;n++)assert.equal((await request('POST','/auth/login',{password:'wrong password'})).status,401);
 assert.equal((await request('POST','/auth/login',{password})).status,429);
 auth.attempts.clear();let signed=await request('POST','/auth/login',{password});assert.equal(signed.status,200);const second=cookie(signed);
 // Restarts preserve both the password and active session digests (also used during self-updates).
 auth=new Auth({file});service.context.auth=auth;assert.equal((await request('GET','/',undefined,second)).status,200);
 const changed=await request('POST','/auth/password',{password:'new password 456'},first);assert.equal(changed.status,200);const fresh=cookie(changed);
 assert.equal((await request('GET','/',undefined,second)).status,303);assert.equal((await request('GET','/',undefined,first)).status,303);
 assert.equal((await request('POST','/auth/login',{password})).status,401);
 assert.equal((await request('GET','/',undefined,fresh)).status,200);
 assert.equal((await request('POST','/auth/logout',{},fresh)).status,200);assert.equal((await request('GET','/',undefined,fresh)).status,303);
 signed=await request('POST','/auth/login',{password:'new password 456'});const expiring=cookie(signed);
 auth.save(Object.assign({},auth.record,{sessions:auth.record.sessions.map(s=>({...s,expiresAt:Date.now()-1}))}));assert.equal((await request('GET','/',undefined,expiring)).status,303);
 // A corrupt credential file must never disable authentication.
 fs.writeFileSync(file,'not JSON');auth=new Auth({file});service.context.auth=auth;assert.equal((await request('GET','/')).status,503);assert.equal((await request('POST','/auth/password',{password})).status,503);
 // Storage failures must not enable an unpersisted password.
 const blocker=path.join(directory,'blocked');fs.writeFileSync(blocker,'x');auth=new Auth({file:path.join(blocker,'auth.json')});assert.ok(auth.error);
 console.log('PASS authentication HTTP: setup, hashes, cookies, API gates, local widget exception, CSRF, rate limits, restart persistence, password rotation, logout, expiry and fail-closed configuration');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{server.close();fs.rmSync(directory,{recursive:true,force:true});});
