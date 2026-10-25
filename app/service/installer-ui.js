'use strict';
module.exports = `
var installState=null,installRequest=false,installTimer=null;
function installBusy(){return !!(installState&&installState.busy)}
function renderInstaller(d){
 installState=d;
 var u=d.upload,j=d.job,busy=installBusy()||installRequest;
 $('installFile').disabled=busy;
 $('uploadApp').disabled=busy||!d.available||!$('installFile').files||!$('installFile').files.length;
 $('installConnection').textContent=d.available?'Root agent connected. Installation can be verified.':'Root agent disconnected. Connect it before uploading an app.';
 $('installReview').hidden=!u||!!j;
 if(u){$('installName').textContent=u.name;$('installPackage').textContent=u.packageId;$('installVersion').textContent=u.version;$('installSize').textContent=(u.bytes/1048576).toFixed(2)+' MiB'}
 $('installApp').disabled=busy||!u||!d.available;
 $('installCheck').hidden=!j||busy;
 $('installViewApps').hidden=!j||!j.verified;
 if(j){var labels={checking:'Checking installed apps…',installing:'Installing…',verifying:'Verifying…',verified:'Installation verified',unverified:'Installation not verified',failed:'Installation stopped'};$('installStage').textContent=labels[j.state]||j.state;$('installMessage').textContent=j.message;}
 if(!busy&&u&&!j){$('installStage').textContent='Ready to install';$('installMessage').textContent='Signature files found. Their validity will be checked by the TV.';}
 clearTimeout(installTimer);
 if(d.busy)installTimer=setTimeout(loadInstaller,1500);
}
function loadInstaller(){return api('/installer').then(renderInstaller).catch(function(e){$('installStage').textContent='Status unavailable';$('installMessage').textContent=e.message+'. An installation already sent may still finish. Check status before retrying.';$('installCheck').hidden=false;});}
$('installFile').onchange=function(){
 var f=this.files&&this.files[0];$('uploadApp').disabled=!f||installRequest||installBusy()||!installState||!installState.available;
 $('installReview').hidden=true;
 if(f&&(!/\\.wgt$/i.test(f.name)||f.size>33554432)){$('uploadApp').disabled=true;$('installStage').textContent='Choose a .wgt file up to 32 MiB';return;}
 $('installStage').textContent=f?'File selected: '+f.name:'Choose a file to begin.';$('installMessage').textContent='';
};
$('uploadApp').onclick=function(){
 var f=$('installFile').files&&$('installFile').files[0];if(!f||installRequest||installBusy())return;
 installRequest=true;renderInstaller(installState);$('installStage').textContent='Uploading…';$('installMessage').textContent='Keep this page open until the upload finishes.';
 var xhr=new XMLHttpRequest();xhr.open('POST','/installer/upload');xhr.timeout=125000;xhr.setRequestHeader('Content-Type','application/octet-stream');
 xhr.upload.onprogress=function(e){if(e.lengthComputable)$('installStage').textContent='Uploading… '+Math.round(e.loaded/e.total*100)+'%';};
 function failed(message){installRequest=false;$('installStage').textContent='Upload failed';$('installMessage').textContent=message;$('installFile').disabled=false;$('uploadApp').disabled=false;$('installReview').hidden=true;}
 xhr.onload=function(){var d;try{d=JSON.parse(xhr.responseText)}catch(e){return failed('Unexpected response. Check status before retrying.')}if(xhr.status!==201)return failed(d.error||'Upload rejected');installRequest=false;renderInstaller(d);};
 xhr.onerror=function(){failed('Connection lost. The app was not submitted for installation.');};xhr.ontimeout=function(){failed('Upload timed out. Check status and choose the file again.');};xhr.send(f);
};
$('installApp').onclick=function(){
 if(installRequest||installBusy()||!installState||!installState.upload)return;
 installRequest=true;renderInstaller(installState);$('installStage').textContent='Starting installation…';
 api('/installer/install',{token:installState.upload.token}).then(function(d){installRequest=false;renderInstaller(d);}).catch(function(e){installRequest=false;$('installStage').textContent='Check installation status';$('installMessage').textContent=e.message+'. Do not submit again until you check status.';$('installCheck').hidden=false;loadInstaller();});
};
$('installCheck').onclick=loadInstaller;
$('installViewApps').onclick=function(){loadApps(true,true);switchPanel('apps');};
`;
