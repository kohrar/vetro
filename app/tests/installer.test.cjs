'use strict';
const assert=require('assert').strict,fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
const {Installer}=require('../service/installer.js');
const {zip}=require('../build.cjs');
const info=require('../service/package-info.js');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vetro-installer-test-'));
const fixture=(signed=true,version='1.2.3')=>zip([
 {uri:'config.xml',data:Buffer.from('<widget version="'+version+'" xmlns:t="http://tizen.org/ns/widgets"><t:application package="fixture123" id="fixture123.app"/><name>Fixture</name></widget>')},
 ...signed?['author-signature.xml','signature1.xml'].map(uri=>({uri,data:Buffer.from('<Signature/>')})):[]]);
let available=true,rows=[],calls=0,output='app_id[fixture123.app] install completed',nextVersion='1.2.3',release;
const install=new Installer({directory,status:()=>({mode:'tv-integration',agent:{connected:available}}),isBusy:()=>false,
 inventory:async()=>({apps:rows}),install:async()=>{calls++;if(release)await new Promise(r=>{release=r});rows=[{packageId:'fixture123',appId:'fixture123.app',version:nextVersion}];return output;}});
const service=require('./service-harness.cjs')(path.resolve(__dirname,'..'));service.context.installer=install;
const server=http.createServer(service.router);
function request(method,url,data,headers={}) {return new Promise((resolve,reject)=>{
 const req=http.request({host:'127.0.0.1',port:server.address().port,path:url,method,headers},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));});req.on('error',reject);req.end(data);
});}
const upload=data=>request('POST','/installer/upload',data,{'content-type':'application/octet-stream'});
const start=token=>request('POST','/installer/install',JSON.stringify({token}),{'content-type':'application/json'});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 assert.equal((await upload(fixture(false))).status,400);assert.equal(fs.readdirSync(directory).length,0);assert.equal(calls,0);
 assert.equal((await request('POST','/installer/upload',fixture(),{'content-type':'application/octet-stream',origin:'http://other.test'})).status,403);
 available=false;assert.equal((await upload(fixture())).status,503);available=true;
 assert.equal((await request('POST','/installer/upload',Buffer.alloc(0),{'content-type':'application/octet-stream','content-length':String(info.MAX_WGT+1)})).status,413);
 let u=await upload(fixture());assert.equal(u.status,201);assert.equal(u.body.upload.version,'1.2.3');assert.equal((await start('../anything')).status,409);
 release=true;let begun=await start(u.body.upload.token);assert.equal(begun.status,202);await new Promise(r=>setImmediate(r));
 assert.equal((await start(u.body.upload.token)).status,409);assert.equal((await upload(fixture())).status,409);assert.equal(calls,1);
 release();release=null;await install.completion;assert.equal(install.job.state,'verified');assert.equal(fs.readdirSync(directory).length,0);
 assert.equal((await request('GET','/installer')).body.job.verified,true,'result survives browser reload');
 // Existing app + an installer that reports failure must never become success.
 output='app_id[fixture123.app] install failed';u=await upload(fixture());await start(u.body.upload.token);await install.completion;
 assert.equal(install.job.verified,false);assert.equal(install.job.state,'unverified');
 // A success log with the wrong registered version must remain unverified.
 output='install completed';nextVersion='0.9.0';u=await upload(fixture());await start(u.body.upload.token);await install.completion;
 assert.equal(install.job.verified,false);assert.match(install.job.message,/could not be confirmed/);
 // Abort deletes partial data and releases the upload lock.
 const EventEmitter=require('events');const req=new EventEmitter();req.headers={'content-type':'application/octet-stream'};req.resume=()=>{};
 const receiving=install.receive(req);req.emit('data',Buffer.from('partial'));req.emit('aborted');await assert.rejects(receiving,/interrupted/);
 assert.equal(install.busy(),false);assert.equal(fs.readdirSync(directory).length,0);
 u=await upload(fixture());install.upload.expiresAt=0;assert.equal((await start(u.body.upload.token)).status,409);assert.equal(fs.readdirSync(directory).length,0);
 console.log('PASS installer HTTP: signed upload, origin/size/offline guards, explicit review, duplicate prevention, fresh version verification, failure/stale-version handling, abort cleanup and expiry');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{install.clear();server.close();fs.rmSync(directory,{recursive:true,force:true});});
