'use strict';
module.exports = `
var installState=null,installRequest=false,installTimer=null,installReconnectUntil=0;
function installBusy(){return !!(installState&&installState.busy)}
function renderInstaller(d){
 installState=d;
 var u=d.upload,j=d.job,busy=installBusy()||installRequest;
 $('installFile').disabled=busy;
 $('uploadApp').disabled=busy||!d.available||!$('installFile').files||!$('installFile').files.length;
 $('installConnection').textContent=d.available?'Root agent connected. Installation can be verified.':'Root agent disconnected. Connect it before uploading an app.';
 $('installReview').hidden=!u||!!j;
 if(u){$('installName').textContent=u.name;$('installPackage').textContent=u.packageId;$('installVersion').textContent=u.version;$('installSize').textContent=(u.bytes/1048576).toFixed(2)+' MiB'}
 $('selfUpdateWarning').hidden=!u||!u.selfUpdate||!!j;
 $('installApp').textContent=u&&u.selfUpdate?'Update Vetro and restart':'Install on TV';
 $('installApp').disabled=busy||!u||!d.available||!!(u.selfUpdate&&!$('confirmSelfUpdate').checked);
 $('installCheck').hidden=!j||busy;
 $('reloadUpdatedVetro').hidden=!j||!j.selfUpdate||!j.verified;
 $('installViewApps').hidden=!j||!j.verified||!!j.selfUpdate;
 if(j&&j.selfUpdate&&d.busy)installReconnectUntil=installReconnectUntil||Date.now()+240000;
 if(j&&!d.busy)installReconnectUntil=0;
 if(j){var labels={checking:'Checking installed apps…',installing:'Installing…',verifying:'Verifying…',waiting_restart:'Waiting for Vetro to restart…',verified:'Installation verified',unverified:'Installation not verified',failed:'Installation stopped'};$('installStage').textContent=labels[j.state]||j.state;$('installMessage').textContent=j.message;}
 if(!busy&&u&&!j){$('installStage').textContent='Ready to install';$('installMessage').textContent=u.selfUpdate?'Vetro '+u.currentVersion+' → '+u.version+'. Same author certificate found. The TV will validate signatures.':'Signature files found. Their validity will be checked by the TV.';}
 clearTimeout(installTimer);
 if(d.busy)installTimer=setTimeout(loadInstaller,1500);
}
$('confirmSelfUpdate').onchange=function(){if(installState)renderInstaller(installState);};
function loadInstaller(){return api('/installer').then(renderInstaller).catch(function(e){$('installStage').textContent='Status unavailable';$('installMessage').textContent=e.message+'. An installation already sent may still finish. Check status before retrying.';$('installCheck').hidden=false;if(Date.now()<installReconnectUntil){$('installStage').textContent='Waiting for Vetro to restart…';clearTimeout(installTimer);installTimer=setTimeout(loadInstaller,2000);}});}
$('installFile').onchange=function(){
 var f=this.files&&this.files[0];$('uploadApp').disabled=!f||installRequest||installBusy()||!installState||!installState.available;
 $('installReview').hidden=true;
 $('confirmSelfUpdate').checked=false;
 if(f&&(!/\\.wgt$/i.test(f.name)||f.size>33554432)){$('uploadApp').disabled=true;$('installStage').textContent='Choose a .wgt file up to 32 MiB';return;}
 $('installStage').textContent=f?'File selected: '+f.name:'Choose a file to begin.';$('installMessage').textContent='';
};
$('uploadApp').onclick=function(){
 var f=$('installFile').files&&$('installFile').files[0];if(!f||installRequest||installBusy())return;
 installRequest=true;renderInstaller(installState);$('installStage').textContent='Uploading…';$('installMessage').textContent='Keep this page open until the upload finishes.';
 var xhr=new XMLHttpRequest();xhr.open('POST','/installer/upload');xhr.timeout=125000;xhr.setRequestHeader('Content-Type','application/octet-stream');
 xhr.upload.onprogress=function(e){if(e.lengthComputable)$('installStage').textContent='Uploading… '+Math.round(e.loaded/e.total*100)+'%';};
 function failed(message){installRequest=false;$('installStage').textContent='Upload failed';$('installMessage').textContent=message;$('installFile').disabled=false;$('uploadApp').disabled=false;$('installReview').hidden=true;}
 xhr.onload=function(){var d;try{d=JSON.parse(xhr.responseText)}catch(e){return failed('Unexpected response. Check status before retrying.')}if(xhr.status!==201)return failed(d.error||'Upload rejected');installRequest=false;$('confirmSelfUpdate').checked=false;renderInstaller(d);};
 xhr.onerror=function(){failed('Connection lost. The app was not submitted for installation.');};xhr.ontimeout=function(){failed('Upload timed out. Check status and choose the file again.');};xhr.send(f);
};
$('installApp').onclick=function(){
 if(installRequest||installBusy()||!installState||!installState.upload)return;
 installRequest=true;renderInstaller(installState);$('installStage').textContent='Starting installation…';
 if(installState.upload.selfUpdate){if(!$('confirmSelfUpdate').checked){installRequest=false;renderInstaller(installState);return;}installReconnectUntil=Date.now()+240000;}
 api('/installer/install',{token:installState.upload.token,confirmSelfUpdate:!!installState.upload.selfUpdate}).then(function(d){installRequest=false;renderInstaller(d);}).catch(function(e){installRequest=false;$('installStage').textContent='Check installation status';$('installMessage').textContent=e.message+'. Do not submit again until you check status.';$('installCheck').hidden=false;loadInstaller();});
};
$('reloadUpdatedVetro').onclick=function(){window.location.reload();};
$('installCheck').onclick=loadInstaller;
$('installViewApps').onclick=function(){loadApps(true,true);switchPanel('apps');};
`;
