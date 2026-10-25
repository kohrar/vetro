'use strict';
module.exports=`
function loadPasswordSettings(){return api('/auth/status').then(function(d){$('passwordState').textContent=d.enabled?'Password protection is on. Saving a new password signs out other browsers.':'Set a password to require sign-in before anyone can access this dashboard or its controls.';$('signOutDashboard').hidden=!d.enabled;}).catch(function(e){$('passwordState').textContent=e.message;});}
$('passwordForm').onsubmit=function(e){e.preventDefault();var input=$('dashboardPassword'),button=$('saveDashboardPassword');if(button.disabled)return;button.disabled=true;$('passwordFeedback').textContent='Saving…';return api('/auth/password',{password:input.value}).then(function(){input.value='';$('passwordFeedback').textContent='Password saved. Other browsers must sign in again.';return loadPasswordSettings();}).catch(function(e){$('passwordFeedback').textContent=e.message;}).finally(function(){input.value='';button.disabled=false;});};
$('signOutDashboard').onclick=function(){return api('/auth/logout',{}).then(function(){location.replace('/login');}).catch(function(e){$('passwordFeedback').textContent=e.message;});};
if(typeof window!=='undefined')window.addEventListener('pageshow',function(e){if(e.persisted)location.reload();});
`;
