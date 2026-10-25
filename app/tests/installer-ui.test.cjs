'use strict';
const assert=require('assert').strict,vm=require('vm');
const nodes={},el=id=>nodes[id]||(nodes[id]={hidden:true,disabled:false,textContent:'',files:[]});
let uploads=0,posts=0,xhr,fetchFail=false;
const data={available:true,busy:false,upload:{token:'abc',name:'Example <app>',packageId:'fixture123',version:'1.2.3',bytes:1024},job:null};
const context={document:{getElementById:el},$:el,setTimeout:()=>1,clearTimeout(){},loadApps(){},switchPanel(){},
 api:async(url,body)=>{if(fetchFail)throw Error('Connection lost');if(body){posts++;return {...data,busy:true,job:{state:'checking',message:'Checking'}};}return data;},
 XMLHttpRequest:function(){xhr=this;this.upload={};this.open=()=>{};this.setRequestHeader=()=>{};this.send=()=>{uploads++;};}};
vm.runInNewContext(require('../service/installer-ui.js'),context);
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 await context.loadInstaller();assert.equal(el('installName').textContent,'Example <app>');
 el('installFile').files=[{name:'bad.zip',size:100}];el('installFile').onchange();assert.equal(el('uploadApp').disabled,true);
 el('installFile').files=[{name:'app.wgt',size:1024}];el('installFile').onchange();assert.equal(el('uploadApp').disabled,false);
 el('uploadApp').onclick();el('uploadApp').onclick();assert.equal(uploads,1);assert.equal(posts,0,'upload never installs without review');
 xhr.status=201;xhr.responseText=JSON.stringify(data);xhr.onload();assert.equal(el('installReview').hidden,false);
 el('installApp').onclick();el('installApp').onclick();await tick();assert.equal(posts,1);assert.equal(el('installFile').disabled,true);
 context.renderInstaller({...data,busy:false,upload:null,job:{state:'unverified',verified:false,message:'Version mismatch'}});
 assert.equal(el('installStage').textContent,'Installation not verified');assert.equal(el('installViewApps').hidden,true);
 context.renderInstaller({...data,upload:null,job:{state:'verified',verified:true,message:'Confirmed'}});assert.equal(el('installViewApps').hidden,false);
 fetchFail=true;await context.loadInstaller();assert.equal(el('installCheck').hidden,false);assert.match(el('installMessage').textContent,/before retrying/);
 console.log('PASS install UI: file limits, review before install, upload/install double-click locks, unverified results, verified inventory link and lost-connection recovery');
})().catch(e=>{console.error(e);process.exitCode=1});
