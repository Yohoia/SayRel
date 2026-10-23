// Run the production renderer and original dialog with synthetic audio and isolated IPC.
const {app,BrowserWindow,session}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../..'),output=path.join(root,'docs/ui-evidence/microphone'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'sayrel-mic-ui-'))
app.setPath('userData',profile)
let win,reference;const errors=[],comparisons=[],shots=[]
const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=code=>win.webContents.executeJavaScript(code)
async function until(code){for(let i=0;i<150;i++){if(await js(code))return;await wait(30)}throw new Error('Timed out: '+code)}
async function settle(){await js('document.fonts.ready');await js('Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>null))).then(()=>true)')}
async function shot(name){await settle();const clip=await js("(()=>{const r=document.querySelector('.settings-microphone-dialog .modal-card').getBoundingClientRect();return{x:Math.floor(r.x)-24,y:Math.floor(r.y)-24,width:Math.ceil(r.width)+48,height:Math.ceil(r.height)+48}})()");fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage(clip)).toPNG());shots.push(name);console.log('PASS '+name)}
const open=()=>js("(()=>{const button=document.querySelectorAll('.settings-picker')[1];button.focus();button.click()})()")
async function close(){await js("document.querySelector('.settings-microphone-dialog .modal-close').click()");await until("!document.querySelector('.settings-microphone-dialog')");await until("window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))&&window.__contexts.every(c=>c.state==='closed')");assert.equal(await js("document.activeElement===document.querySelectorAll('.settings-picker')[1]"),true,'dialog restores focus to its opener')}
const textGeometry=original=>`(()=>{const card=document.querySelector('${original?'#mui-modal':'.settings-microphone-dialog .modal-card'}'),base=card.getBoundingClientRect();
 const nodes=[card.querySelector('${original?'.custom-modal--title':'h2'}'),card.querySelector('${original?'.custom-modal--title+div':'.settings-mic-description'}'),...card.querySelectorAll('${original?'button .MuiTypography-root':'.settings-mic-copy>*'}')];
 return nodes.map(node=>{const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect(),s=getComputedStyle(node);return{x:r.x-base.x,y:r.y-base.y,width:r.width,height:r.height,font:s.fontSize,line:s.lineHeight,weight:s.fontWeight}});})()`
const geometry=original=>`(()=>{const rect=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{width:r.width,height:r.height,radius:s.borderRadius,padding:s.padding,font:s.fontSize,line:s.lineHeight}};
 const card=document.querySelector('${original?'#mui-modal':'.settings-microphone-dialog .modal-card'}'),title=card.querySelector('${original?'.custom-modal--title':'h2'}'),description=card.querySelector('${original?'.custom-modal--title+div':'.settings-mic-description'}');
 const rows=[...card.querySelectorAll('${original?'button:not(.custom-modal--close-button)':'.settings-mic-option'}')];
 const meter=rows.find(b=>b.querySelector('${original?'div[style]':'[role=meter]'}'));
 return{card:rect(card),title:rect(title),description:rect(description),rows:rows.map(b=>rect(b)),text:rows.map(b=>b.textContent),bodyGap:rows[0]?rows[0].getBoundingClientRect().top-description.getBoundingClientRect().bottom:null};})()`
app.whenReady().then(async()=>{
 fs.mkdirSync(output,{recursive:true});session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}))
 win=new BrowserWindow({width:1080,height:750,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}})
 reference=new BrowserWindow({width:1080,height:750,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}})
 for(const window of [win,reference])window.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message)})
 await win.loadURL('about:blank');win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Page.enable')
 await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.__contexts=[];window.__gains=[];window.__streams=[];window.__requests=[];window.__calls=[];window.__phase='idle';window.__reject=false;window.__pause=false;
 const RealAudioContext=window.AudioContext;window.AudioContext=class extends RealAudioContext{constructor(...a){super(...a);window.__contexts.push(this)}createGain(){const g=super.createGain();window.__gains.push(g);return g}};
 Object.defineProperty(window,'sayrel',{configurable:true,get(){return this.__bridge},set(value){const invoke=value.invoke.bind(value);value.invoke=async(channel,...args)=>{window.__calls.push([channel,...args]);if(channel==='audio:get-devices-async')return[{deviceId:'builtin',label:'MacBook Pro Microphone',isDefault:true,transport:'builtin'},{deviceId:'usb',label:'USB Microphone',isDefault:false,transport:'usb'}];if(channel==='recording-machine:state')return{phase:window.__phase,context:{sessionId:null,handsFree:false}};return invoke(channel,...args)};this.__bridge=value}});
 `})
 await win.loadFile(path.join(root,'.build/ui-review/hub.html'));await until("!!document.querySelector('.home-settings')")
 await js(`(()=>{const media=navigator.mediaDevices,original=media.getUserMedia.bind(media);window.__devices=null;const enumerate=media.enumerateDevices.bind(media);media.enumerateDevices=()=>window.__devices===null?enumerate():Promise.resolve(window.__devices);media.getUserMedia=async constraints=>{window.__requests.push(constraints);if(window.__reject)throw new DOMException('Microphone access denied','NotAllowedError');if(window.__pause)await new Promise(resolve=>window.__release=resolve);const stream=await original(constraints);window.__streams.push(stream);return stream};})()`)
 await js("window.sayrel.invoke('store:use','patch',{language:'zh-CN'});document.querySelector('.home-settings').click()")
 await until("document.querySelectorAll('.settings-picker').length===2")
 await reference.loadFile(path.join(root,'.build/typeless-floating/microphone-reference.html'))
 await reference.webContents.executeJavaScript("Promise.all([document.fonts.load('14px SF Pro'),document.fonts.load('14px MiSans','麦克风')]).then(()=>true)")
 for(const locale of ['zh-CN','en']){
  await js(`window.sayrel.invoke('store:use','patch',{language:${JSON.stringify(locale)},micDevice:null})`);await open()
  await until("document.querySelectorAll('.settings-mic-option').length===3&&document.querySelectorAll('.settings-mic-level .is-active').length===6")
  await settle()
  const devices=locale==='zh-CN'?[['default','自动检测 (MacBook Pro Microphone)','default'],['fixture-built-in','MacBook Pro Microphone','recommended'],['fixture-usb','USB Microphone','external']]:[['default','Auto-detect (MacBook Pro Microphone)','default'],['fixture-built-in','MacBook Pro Microphone','recommended'],['fixture-usb','USB Microphone','external']]
  await reference.webContents.executeJavaScript(`renderMicrophoneReference(${JSON.stringify({locale,selected:'default',volume:1,devices:devices.map(([deviceId,label,description])=>({deviceId,label,description}))})})`)
  await wait(350)
  const actual=await js(geometry(false)),expected=await reference.webContents.executeJavaScript(geometry(true)),text=await js(textGeometry(false)),sourceText=await reference.webContents.executeJavaScript(textGeometry(true));comparisons.push({locale,actual,expected,text,sourceText});assert.equal(text.length,sourceText.length);for(let i=0;i<text.length;i++)for(const key of Object.keys(text[i])){if(typeof text[i][key]==='number')assert.ok(Math.abs(text[i][key]-sourceText[i][key])<.3,locale+' text '+i+' '+key+': '+text[i][key]+' vs '+sourceText[i][key]);else assert.equal(text[i][key],sourceText[i][key])}
  assert.equal(actual.card.width,448);assert.equal(actual.card.radius,'16px');assert.equal(actual.rows.length,3)
  for(const key of ['font','line']){assert.equal(actual.title[key],expected.title[key]);assert.equal(actual.description[key],expected.description[key])}
  for(let i=0;i<actual.rows.length;i++){assert.equal(actual.rows[i].height,expected.rows[i].height);assert.equal(actual.rows[i].width,expected.rows[i].width);assert.equal(actual.rows[i].radius,expected.rows[i].radius);assert.equal(actual.rows[i].padding,expected.rows[i].padding)}
  assert.equal(actual.card.height,expected.card.height);assert.deepEqual(actual.text,expected.text)
  const bars=await js("[...document.querySelectorAll('.settings-mic-level>i')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{width:r.width,height:r.height,radius:s.borderRadius,transition:s.transitionDuration}})")
  assert.deepEqual(bars,Array(6).fill({width:6,height:22,radius:'999px',transition:'0.15s'}))
  const backdrop=await js("getComputedStyle(document.querySelector('.settings-microphone-dialog>.modal-backdrop'),'::before').backgroundColor");assert.equal(backdrop,await reference.webContents.executeJavaScript("getComputedStyle(document.querySelector('.MuiBackdrop-root')).backgroundColor"));
  const fading=await js("getComputedStyle(document.querySelector('.settings-microphone-dialog .modal-card')).animationDuration");assert.equal(fading,'0.2s')
  await shot('microphone-'+locale)
  await js("window.__gains.forEach(g=>g.gain.value=0)");await until("document.querySelectorAll('.settings-mic-level .is-active').length===0")
  await shot('microphone-silent-'+locale)
  const point=await js("(()=>{const r=document.querySelectorAll('.settings-mic-option')[2].getBoundingClientRect();return{x:r.x+40,y:r.y+r.height/2}})()");await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await until("!!document.querySelector('.settings-mic-option .MuiTouchRipple-rippleVisible')");await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point})
  await until("document.querySelectorAll('.settings-mic-option')[2].getAttribute('aria-checked')==='true'&&document.querySelectorAll('.settings-mic-level .is-active').length===6")
  assert.equal(await js("window.__requests.at(-1).audio.deviceId.exact"),'fixture-usb')
  assert.equal(await js("window.__requests.at(-1).audio.noiseSuppression"),true)
  assert.equal(await js("window.__streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length"),1)
  await shot('microphone-usb-'+locale);await close()
 }
 await js("window.__devices=Array.from({length:9},(_,i)=>({deviceId:'extra-'+i,kind:'audioinput',label:'External microphone '+i,groupId:'extra'}));navigator.mediaDevices.dispatchEvent(new Event('devicechange'))");await open();await until("document.querySelectorAll('.settings-mic-option').length===10");assert.equal(await js("document.querySelector('.settings-mic-body').getBoundingClientRect().height"),368);await shot('microphone-many-devices');await close();await js("window.__devices=null;navigator.mediaDevices.dispatchEvent(new Event('devicechange'))");
 await js("window.__reject=true");await open();await until("!!document.querySelector('.settings-microphone-dialog')");await wait(150);await close();await js("window.__reject=false")
 await js("window.__phase='recording'");const count=await js('window.__requests.length');await open();await wait(200);assert.equal(await js('window.__requests.length'),count);await close();await js("window.__phase='idle'")
 await js("window.__pause=true");await open();await until("!!window.__release");await js("document.querySelector('.settings-microphone-dialog .modal-close').click();window.__pause=false;window.__release()")
 await until("!document.querySelector('.settings-microphone-dialog')&&window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))&&window.__contexts.every(c=>c.state==='closed')")
 await js("window.__devices=[];navigator.mediaDevices.dispatchEvent(new Event('devicechange'))");await open();await until("!!document.querySelector('.settings-mic-empty')");assert.equal(await js("document.querySelectorAll('.settings-mic-option').length"),0);await shot('microphone-empty');await close()
 assert.equal(await js("window.__calls.some(c=>['recording-machine:start','audio:ai-voice-flow','audio:opus-compress-by-buffer'].includes(c[0]))"),false)
 assert.deepEqual(errors,[])
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({comparisons,shots,errors,scope:'Original dialog JSX versus real app with synthetic audio. No physical microphone, native permission changes or provider calls.'},null,2))
 console.log('PASS switching, silence, denial, active-recording guard, late stream cleanup and empty state')
}).catch(error=>{console.error(error);console.error(errors);process.exitCode=1}).finally(()=>{win?.destroy();reference?.destroy();app.exit(process.exitCode||0)})
app.on('quit',()=>{try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:3})}catch{}})
