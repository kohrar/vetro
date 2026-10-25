'use strict';
const assert=require('assert').strict,vm=require('vm');
const nodes={},el=id=>nodes[id]||(nodes[id]={value:'',disabled:false,hidden:true,textContent:''});
let enabled=false,fail=false,saved=[],redirected;
const context={$:el,location:{replace:u=>redirected=u},api:async(url,body)=>{
 if(url==='/auth/status')return {enabled};
 if(fail)throw Error('Storage unavailable');
 if(url==='/auth/password'){saved.push(body.password);enabled=true;}
 return {ok:true};
}};
vm.runInNewContext(require('../service/auth-ui'),context);
(async()=>{
 await context.loadPasswordSettings();assert.equal(el('signOutDashboard').hidden,true);
 el('dashboardPassword').value='Example test password';let promise=el('passwordForm').onsubmit({preventDefault(){}});assert.equal(el('saveDashboardPassword').disabled,true);await promise;
 assert.equal(saved.length,1);assert.equal(el('dashboardPassword').value,'');assert.equal(el('signOutDashboard').hidden,false);assert.match(el('passwordFeedback').textContent,/Password saved/);
 fail=true;el('dashboardPassword').value='Another test password';await el('passwordForm').onsubmit({preventDefault(){}});assert.equal(el('dashboardPassword').value,'');assert.match(el('passwordFeedback').textContent,/Storage unavailable/);
 fail=false;await el('signOutDashboard').onclick();assert.equal(redirected,'/login');
 const html=require('../service/dashboard')(),login=require('../service/login')();
 assert.equal((html.match(/id="dashboardPassword"/g)||[]).length,1);assert.match(html,/type="password" autocomplete="new-password"/);assert.ok(!login.includes('id="quick"'));assert.ok(!login.includes('service/main'));
 console.log('PASS password UI: single masked field, save lock, field clearing, setup status, logout redirect and separate login document');
})().catch(e=>{console.error(e);process.exitCode=1});
