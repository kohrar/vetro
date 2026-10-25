'use strict';
const assert=require('assert').strict,fs=require('fs'),os=require('os'),path=require('path'),EventEmitter=require('events');
const {Installer}=require('../service/installer.js');
const {zip}=require('../build.cjs');
const info=require('../service/package-info.js');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'vetro-self-update-')),root=path.join(base,'installed'),directory=path.join(base,'uploads'),checkpoint=path.join(base,'state','update.json');
fs.mkdirSync(root);
function signature(name){const pem=fs.readFileSync(path.join(__dirname,'fixtures',name),'utf8');return '<Signature><X509Data><X509Certificate>'+pem.replace(/-----[^\n]+-----|\s/g,'')+'</X509Certificate></X509Data></Signature>';}
const author=signature('update-author.pem'),other=signature('update-other-author.pem');
fs.writeFileSync(path.join(root,'author-signature.xml'),author);
function files(version='0.2.5',certificate=author){return [
 {uri:'config.xml',data:Buffer.from('<widget version="'+version+'" xmlns:t="http://tizen.org/ns/widgets"><t:application package="vetrotvapp" id="vetrotvapp.app"/><t:service id="vetrotvapp.svc"/><name>Vetro</name></widget>')},
 {uri:'author-signature.xml',data:Buffer.from(certificate)},{uri:'signature1.xml',data:Buffer.from('<Signature/>')},
 ...['service/main.js','service/installer.js','service/self-update.js','service/build-info.js','service/platform.js','payload/SamsungTvRootAgent.dll','payload/SamsungTvArchiveRoot.dll'].map(uri=>({uri,data:Buffer.from(uri==='service/platform.js'?'tv-integration':uri==='service/build-info.js'?'module.exports = '+JSON.stringify({version})+';':uri+version)}))];}
let available=true,calls=0,simulateRestart=false,failInstall=false,inventoryVersion='0.2.5';
function make(version='0.2.4',storage=checkpoint){return new Installer({root,directory,checkpoint:storage,version,status:()=>({mode:'tv-integration',agent:{connected:available}}),isBusy:()=>false,
 inventory:async()=>({apps:[{packageId:'vetrotvapp',appId:'vetrotvapp.app',version:inventoryVersion}]}),
 install:async()=>{calls++;if(simulateRestart)throw Error('SDB disconnected during update');if(failInstall)throw Error('offline');return 'install completed';}});}
async function upload(i,buffer){const req=new EventEmitter();req.headers={'content-type':'application/octet-stream'};req.resume=()=>{};const p=i.receive(req);req.emit('data',buffer);req.emit('end');return p;}
const tick=()=>new Promise(r=>setImmediate(r));
function installFiles(list){for(const f of list){const p=path.join(root,f.uri);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,f.data);}}
(async()=>{
 let i=make();
 await assert.rejects(upload(i,zip(files('0.2.4'))),/newer/);
 await assert.rejects(upload(i,zip(files('0.2.3'))),/newer/);
 await assert.rejects(upload(i,zip(files('0.2.5',other))),/same author/);
 await assert.rejects(upload(i,zip(files().filter(f=>f.uri!=='payload/SamsungTvRootAgent.dll'))),/incomplete/);
 const wrongMetadata=files();wrongMetadata.find(f=>f.uri==='service/build-info.js').data=Buffer.from('module.exports = {"version":"0.2.4"};');await assert.rejects(upload(i,zip(wrongMetadata)),/versions do not match/);
 const movedPort=files();movedPort.find(f=>f.uri==='service/build-info.js').data=Buffer.from('module.exports = '+JSON.stringify({version:'0.2.5',port:9123})+';');
 await assert.rejects(upload(i,zip(movedPort)),/desktop tools to change the dashboard port/);
 const samePort=make();samePort.selfUpdate.port=9123;const acceptedCustom=await upload(samePort,zip(movedPort));assert.equal(acceptedCustom.upload.selfUpdate,true);samePort.clear();
 const u=(await upload(i,zip(files()))).upload;assert.equal(u.selfUpdate,true);
 assert.throws(()=>i.start(u.token),/Confirm/);assert.equal(calls,0);
 simulateRestart=true;i.start(u.token,true);await i.completion;
 assert.equal(calls,1);assert.equal(i.job.state,'waiting_restart');assert.equal(fs.existsSync(checkpoint),true);assert.equal(fs.existsSync(path.join(directory,u.token+'.wgt')),true,'package survives disconnect');
 const saved=JSON.parse(fs.readFileSync(checkpoint));assert.equal(saved.job.verified,false);assert.equal(saved.job.state,'waiting_restart');
 // A different process with matching version, content and native inventory can confirm the update.
 installFiles(files());const updated=make('0.2.5');updated.recover();await tick();await tick();assert.equal(updated.job.state,'verified');assert.equal(updated.job.verified,true);assert.equal(calls,1,'restart never retries install');
 assert.equal(fs.existsSync(path.join(directory,u.token+'.wgt')),false,'completed update removes the upload');
 // Matching version alone is insufficient: compare every uploaded file.
 fs.writeFileSync(checkpoint,JSON.stringify(saved));fs.writeFileSync(path.join(root,'service/main.js'),'different build');
 const corrupt=make('0.2.5');corrupt.recover();await tick();await tick();assert.equal(corrupt.job.state,'unverified');assert.match(corrupt.job.message,/does not match/);assert.equal(calls,1);
 // Previous version after a rejected/interrupted update is not reported as success.
 fs.writeFileSync(checkpoint,JSON.stringify(saved));const old=make('0.2.4');old.recover();await tick();await tick();assert.equal(old.job.verified,false);
 // Service can return before the root agent. Wait, then verify once it is available.
 installFiles(files());fs.writeFileSync(checkpoint,JSON.stringify(saved));available=false;
 const late=make('0.2.5');late.recover();assert.equal(late.job.state,'waiting_restart');available=true;late.recover();await tick();await tick();assert.equal(late.job.verified,true);assert.equal(calls,1);
 // A correct build still requires native inventory confirmation.
 fs.writeFileSync(checkpoint,JSON.stringify(saved));inventoryVersion='0.2.4';const stale=make('0.2.5');stale.recover();await tick();await tick();assert.equal(stale.job.state,'unverified');assert.match(stale.job.message,/native inventory/);inventoryVersion='0.2.5';
 // Timeout leaves a durable uncertain result and does not submit anything.
 available=false;saved.deadline=Date.now()-1;fs.writeFileSync(checkpoint,JSON.stringify(saved));const timed=make('0.2.5');timed.recover();assert.equal(timed.job.state,'unverified');assert.match(timed.job.message,/No update was retried/);
 // Durable checkpoint failure stops BEFORE the native installation command.
 available=true;simulateRestart=false;const blocked=make('0.2.4',path.join(base,'not-a-directory','state.json'));fs.writeFileSync(path.join(base,'not-a-directory'),'blocked');
 const b=(await upload(blocked,zip(files()))).upload;blocked.start(b.token,true);await blocked.completion;assert.equal(blocked.job.state,'failed');assert.equal(calls,1);
 // Corrupt checkpoint data is never interpreted as a command or a successful update.
 fs.writeFileSync(checkpoint,'invalid');const broken=make('0.2.5');broken.recover();assert.equal(broken.job.state,'unverified');assert.equal(calls,1);
 [i,updated,corrupt,old,late,timed,blocked,broken,stale].forEach(x=>clearTimeout(x.selfUpdate.timer));
 console.log('PASS self updates: version/author/integration guards, explicit consent, durable checkpoint, interrupted transport, restart identity, full payload hashes, delayed root, timeout, write failure and no resubmission');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(base,{recursive:true,force:true}));
