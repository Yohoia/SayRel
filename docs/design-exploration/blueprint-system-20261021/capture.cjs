const { app,BrowserWindow,session }=require('electron')
const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=require('node:fs')
const {resolve,join}=require('node:path')
const {tmpdir}=require('node:os')
const assert=require('node:assert/strict')
const root=resolve(__dirname,'../../..'),output=join(__dirname,process.argv.includes('--baseline')?'before':'after'),profile=mkdtempSync(join(tmpdir(),'sayrel-blueprint-'))
app.setPath('userData',profile)
app.disableHardwareAcceleration()
let win;const reports=[],errors=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));const js=code=>win.webContents.executeJavaScript(code)
async function until(code){for(let i=0;i<100;i++){if(await js(code))return;await delay(50)}throw Error(code)}
async function page(file='hub',hash='/dashboard',query={}){await win.loadFile(join(root,'.build/ui-review',file+'.html'),{hash,query});await until("document.querySelector('#root')?.children.length>0");await js('document.fonts.ready');await delay(320)}
async function shot(name){await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await delay(350);const state=await js(`({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,missing:[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src)})`);const {data}=await win.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:true});writeFileSync(join(output,name+'.png'),Buffer.from(data,'base64'));reports.push({name,...state});assert.equal(state.overflow,false,name+' horizontal overflow');assert.deepEqual(state.missing,[],name+' missing image');console.log('PASS '+name)}
app.whenReady().then(async()=>{
 mkdirSync(output,{recursive:true});session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));win=new BrowserWindow({width:1080,height:750,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}});win.webContents.debugger.attach('1.3');win.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message)})
 for(const route of ['dashboard','history','dictionary','providers']){await page('hub','/'+route);await until("!!document.querySelector('.page-title')");await shot(route)}
 await js("window.sayrel.invoke('page:open-settings-modal','settings')");await until("!!document.querySelector('.settings-modal')");await shot('settings')
 for(const [label,name] of [['Personalization','个性化'],['About','关于'],['Help','帮助']]){await js(`Array.from(document.querySelectorAll('.settings-nav-item')).find(n=>n.textContent.trim()===${JSON.stringify(label)}).click()`);await shot('settings-'+name)}
 win.setContentSize(840,560);await shot('settings-help-small');await js("Array.from(document.querySelectorAll('.settings-nav-item')).find(n=>n.textContent.trim()==='Settings').click()");await shot('settings-small');await js("document.querySelector('.settings-content').scrollTop=document.querySelector('.settings-content').scrollHeight");await shot('settings-small-bottom');win.setContentSize(1080,750)
 await page('hub','/history',{state:'empty'});await shot('history-empty');await page('hub','/dictionary',{state:'empty'});await shot('dictionary-empty')
 for(const route of ['dashboard','history','dictionary','providers']){await page('hub','/'+route);await js("window.sayrel.invoke('appearance:set-preference','dark')");await delay(100);await shot(route+'-dark')}
 await page('onboarding','');await shot('onboarding-permissions');await js("document.querySelector('.secondary-onboarding-footer .secondary-primary-button').click()");await until("!!document.querySelector('[role=meter]')");await shot('onboarding-microphone');await until("!document.querySelector('.secondary-onboarding-footer .secondary-primary-button').disabled");await js("document.querySelector('.secondary-onboarding-footer .secondary-primary-button').click()");await until("!!document.querySelector('.secondary-shortcut-card,.secondary-keyboard-art')");await shot('onboarding-shortcut')
 win.setContentSize(800,500);await page('interactive-card','');await shot('answer-card')
 win.setContentSize(350,500);await page('sidebar','');await shot('context-sidebar')
 win.setContentSize(750,500);for(const state of ['hover','starting-microphone','recording','hands-free','hands-free-dictating','error']){await page('floating-bar','',{state,mode:'translation'});await until(`document.querySelector('[data-testid=floating-bar]')?.dataset.status===${JSON.stringify(state)}`);await shot('floating-'+state)}
 assert.deepEqual(errors,[])
}).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{mkdirSync(output,{recursive:true});writeFileSync(join(output,'report.json'),JSON.stringify({reports,errors,scope:'Offline fixtures; isolated profile; no real microphone or providers'},null,2));win?.destroy();app.exit(process.exitCode||0)})
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}))
