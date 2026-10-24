// Run the production renderer and original dialog with synthetic audio and isolated IPC.
const {app,BrowserWindow,session}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../../..'),output=path.join(root,'docs/ui-evidence/microphone'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'sayrel-mic-ui-'))
app.setPath('userData',profile)
let win,reference;const errors=[],comparisons=[],shots=[]
const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=code=>win.webContents.executeJavaScript(code)
async function until(code){for(let i=0;i<150;i++){if(await js(code))return;await wait(30)}throw new Error('Timed out: '+code)}
async function settle(){await js('document.fonts.ready');await js('Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>null))).then(()=>true)')}
async function shot(name){await settle();const clip=await js("(()=>{const r=document.querySelector('.settings-microphone-dialog .modal-card').getBoundingClientRect();return{x:Math.floor(r.x)-24,y:Math.floor(r.y)-24,width:Math.ceil(r.width)+48,height:Math.ceil(r.height)+48}})()");fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage(clip)).toPNG());shots.push(name);console.log('PASS '+name)}
const released="window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))&&window.__contexts.every(c=>c.state==='closed')"
const select=index=>js(`document.querySelectorAll('.settings-mic-option')[${index}].click()`)
const open=()=>js("(()=>{const button=document.querySelectorAll('.settings-picker')[1];button.focus();button.click()})()")
async function close(){await js("document.querySelector('.settings-microphone-dialog .modal-close').click()");await until("!document.querySelector('.settings-microphone-dialog')");await until(released);assert.equal(await js("document.activeElement===document.querySelectorAll('.settings-picker')[1]"),true,'dialog restores focus to its opener')}
async function instrumentMedia(){
 await js(`(()=>{
  const media=navigator.mediaDevices,original=media.getUserMedia.bind(media),enumerate=media.enumerateDevices.bind(media);
  window.__devices=null;
  media.enumerateDevices=()=>window.__devices===null?enumerate():Promise.resolve(window.__devices);
  media.getUserMedia=async constraints=>{
   window.__requests.push(constraints);
   if(window.__reject)throw new DOMException('Microphone access denied','NotAllowedError');
   if(window.__missing)throw new DOMException('Device could not open','NotFoundError');
   if(window.__pause)await new Promise((resolve,reject)=>window.__pendingStreams.push(fail=>fail?reject(new DOMException('Late device open failed','NotFoundError')):resolve()));
   window.__creatingFixture=true;
   let stream;
   try{stream=await original(constraints)}finally{window.__creatingFixture=false}
   window.__streams.push(stream);
   for(const track of stream.getTracks()){
    const stop=track.stop.bind(track),record={count:0};window.__trackStops.push(record);
    track.stop=()=>{record.count++;stop()};
   }
   return stream;
  };
 })()`)
}
const setupContinue='.secondary-onboarding-footer .secondary-primary-button'
const micStep="!!document.querySelector('.secondary-volume-bars')"
const readyMic="!!document.querySelector('.secondary-volume-bars')&&!document.querySelector('.secondary-onboarding-footer .secondary-primary-button').disabled"
async function enterMicrophone(){
 await js(`document.querySelector('${setupContinue}').click()`)
 await until(micStep)
}
async function leaveMicrophone(){
 await js("document.querySelector('.secondary-onboarding-back button').click()")
 await until("!document.querySelector('.secondary-volume-bars')")
}
async function dismissToasts(){
 await js("document.querySelectorAll('.sayrel-toast').forEach(node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))")
 await until("!document.querySelector('.sayrel-toast')")
}
async function shotOnboarding(name){
 await settle()
 fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG())
 shots.push(name)
}
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
 window.__contexts=[];window.__gains=[];window.__streams=[];window.__requests=[];window.__calls=[];window.__phase='idle';window.__reject=false;window.__pause=false;window.__failAudio=null;window.__pendingStreams=[];window.__pendingResumes=[];window.__trackStops=[];window.__pcm=[];window.__analysers=[];
 const RealAudioContext=window.AudioContext;
 window.AudioContext=class extends RealAudioContext{
  constructor(...args){
   if(window.__failAudio==='constructor'&&!window.__creatingFixture)throw new Error('Preview context failed');
   super(...args);window.__contexts.push(this);
   const addModule=this.audioWorklet.addModule.bind(this.audioWorklet);
   this.audioWorklet.addModule=(...args)=>{window.__pcm.push('worklet');return addModule(...args)};
  }
  createAnalyser(){
   if(window.__failAudio==='analyser')throw new Error('Preview analyser failed');
   const analyser=super.createAnalyser();window.__analysers.push(analyser);return analyser;
  }
  createMediaStreamSource(stream){
   if(window.__failAudio==='source')throw new Error('Preview source failed');
   return super.createMediaStreamSource(stream);
  }
  resume(){
   if(!window.__creatingFixture){
    if(window.__failAudio==='resume')return Promise.reject(new Error('Preview resume failed'));
    if(window.__pauseResume)return new Promise((resolve,reject)=>window.__pendingResumes.push(()=>super.resume().then(resolve,reject)));
   }
   return super.resume();
  }
  createScriptProcessor(...args){window.__pcm.push('script');return super.createScriptProcessor(...args)}
  createGain(){const gain=super.createGain();window.__gains.push(gain);return gain}
 };
 Object.defineProperty(window,'sayrel',{configurable:true,get(){return this.__bridge},set(value){const invoke=value.invoke.bind(value);value.invoke=async(channel,...args)=>{window.__calls.push([channel,...args]);if(channel==='audio:get-devices-async')return[{deviceId:'builtin',label:'MacBook Pro Microphone',isDefault:true,transport:'builtin'},{deviceId:'usb',label:'USB Microphone',isDefault:false,transport:'usb'}];if(channel==='recording-machine:state')return{phase:window.__phase,context:{sessionId:null,handsFree:false}};return invoke(channel,...args)};this.__bridge=value}});
 `})
 await win.loadFile(path.join(root,'.build/ui-review/hub.html'));await until("!!document.querySelector('.home-settings')")
 await instrumentMedia()
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
  assert.deepEqual(await js("window.__requests.at(-1)"),{audio:{deviceId:{exact:'fixture-usb'},noiseSuppression:true},video:false})
  assert.equal(await js("window.__contexts.filter(c=>c.state!=='closed').length"),2,'one synthetic source and one preview context remain after switching')
  assert.equal(await js("JSON.parse(localStorage.getItem('sayrel-ui-settings')).micDevice"),'fixture-usb')
  assert.equal(await js("window.__streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length"),1)
  await shot('microphone-usb-'+locale);await close()
 }
 await js("window.__devices=Array.from({length:9},(_,i)=>({deviceId:'extra-'+i,kind:'audioinput',label:'External microphone '+i,groupId:'extra'}));navigator.mediaDevices.dispatchEvent(new Event('devicechange'))");await open();await until("document.querySelectorAll('.settings-mic-option').length===10");assert.equal(await js("document.querySelector('.settings-mic-body').getBoundingClientRect().height"),368);await shot('microphone-many-devices');await close();await js("window.__devices=null;navigator.mediaDevices.dispatchEvent(new Event('devicechange'))");
 await js("window.__reject=true");await open();await until("!!document.querySelector('.settings-microphone-dialog')");await wait(150);await close();await js("window.__reject=false")
 // Each initialization boundary fails against real Web Audio, then succeeds on retry.
 for(const [failure,message] of [['constructor','Preview context failed'],['analyser','Preview analyser failed'],['source','Preview source failed'],['resume','Preview resume failed']]){
  await js(`window.__failAudio=${JSON.stringify(failure)}`);await open()
  await until(`[...document.querySelectorAll('.sayrel-toast.is-error')].some(t=>t.textContent.includes(${JSON.stringify(message)}))`)
  await until(released)
  assert.equal(await js("document.querySelectorAll('.settings-mic-level .is-active').length"),0)
  await close();await js("window.__failAudio=null");await open()
  await until("document.querySelectorAll('.settings-mic-level .is-active').length===6");await close()
 }
 await js("window.__missing=true");await open()
 await until("[...document.querySelectorAll('.sayrel-toast.is-error')].some(t=>t.textContent.includes('Device could not open'))")
 await until(released);await close();await js("window.__missing=false");await open()
 await until("document.querySelectorAll('.settings-mic-level .is-active').length===6");await close()
 console.log('PASS initialization failures release resources before dismissal and can retry')
 // A new selection can become ready before the cancelled device-open operation finishes.
 await js("window.__pause=true");await open();await until("window.__pendingStreams.length===1")
 await js("window.__pause=false");await select(1)
 await until("document.querySelectorAll('.settings-mic-option')[1].getAttribute('aria-checked')==='true'&&document.querySelectorAll('.settings-mic-level .is-active').length===6")
 const liveBeforeLate=await js("window.__streams.length")
 await js("window.__pendingStreams.shift()()");await until(`window.__streams.length===${liveBeforeLate+1}&&window.__streams.at(-1).getTracks().every(t=>t.readyState==='ended')`)
 assert.equal(await js("window.__streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length"),1)
 assert.equal(await js("document.querySelectorAll('.settings-mic-option')[1].getAttribute('aria-checked')"),'true')
 await close()
 // Readiness waits for resume. Closing during resume releases the stream and context immediately.
 await js("window.__pauseResume=true");await open();await until("window.__pendingResumes.length===1")
 assert.equal(await js("document.querySelectorAll('.settings-mic-level .is-active').length"),0)
 await close();await js("window.__pauseResume=false");await open()
 await until("document.querySelectorAll('.settings-mic-level .is-active').length===6")
 await js("window.__pendingResumes.shift()()");await wait(100)
 assert.equal(await js("window.__streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length"),1)
 assert.equal(await js("document.querySelectorAll('.settings-mic-level .is-active').length"),6)
 await close()
 console.log('PASS pending device switch, resume readiness and late resume isolation')
 // Removing the selected input refreshes the list and falls back to automatic detection.
 await open();await until("document.querySelectorAll('.settings-mic-level .is-active').length===6")
 await js("window.__devices=[{deviceId:'fixture-usb',kind:'audioinput',label:'USB Microphone',groupId:'usb'}];navigator.mediaDevices.dispatchEvent(new Event('devicechange'))")
 await until("document.querySelectorAll('.settings-mic-option').length===2&&document.querySelectorAll('.settings-mic-option')[0].getAttribute('aria-checked')==='true'&&document.querySelectorAll('.settings-mic-level .is-active').length===6")
 assert.deepEqual(await js("window.__requests.at(-1)"),{audio:{noiseSuppression:true},video:false})
 assert.equal(await js("window.__streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length"),1)
 await close();await js("window.__devices=null;navigator.mediaDevices.dispatchEvent(new Event('devicechange'))")
 console.log('PASS device disappearance refreshes the list and previews automatic detection')
 await js("window.__phase='recording'");const count=await js('window.__requests.length');await open();await wait(200);assert.equal(await js('window.__requests.length'),count);await close();await js("window.__phase='idle'")
 await js("window.__pause=true");await open();await until("window.__pendingStreams.length===1");await js("document.querySelector('.settings-microphone-dialog .modal-close').click();window.__pause=false;window.__pendingStreams.shift()()")
 await until("!document.querySelector('.settings-microphone-dialog')&&window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))&&window.__contexts.every(c=>c.state==='closed')")
 await js("window.__devices=[];navigator.mediaDevices.dispatchEvent(new Event('devicechange'))");await open();await until("!!document.querySelector('.settings-mic-empty')");assert.equal(await js("document.querySelectorAll('.settings-mic-option').length"),0);await shot('microphone-empty');await close()
 assert.equal(await js("window.__calls.some(c=>['recording-machine:start','audio:ai-voice-flow','audio:opus-compress-by-buffer','db:history-upsert','db:history-save-audio','db:history-upsert-client-metadata','db:history-upsert-mode-meta'].includes(c[0]))"),false)
 assert.equal(await js("window.__trackStops.every(record=>record.count===1)"),true,'all acquired tracks stop exactly once across closing and later cleanup')
 // The second real preview entry keeps its own capture and meter behavior without PCM processing.
 await win.loadFile(path.join(root,'.build/ui-review/onboarding.html'))
 await until("!!document.querySelector('.secondary-onboarding-footer .secondary-primary-button')")
 await instrumentMedia()
 await js("window.sayrel.invoke('store:use','patch',{micDevice:'fixture-usb'})")
 await enterMicrophone();await until(readyMic)
 await until("Number(document.querySelector('.secondary-volume-bars').getAttribute('aria-valuenow'))>=5")
 assert.deepEqual(await js("window.__pcm"),[],'onboarding preview never opens a PCM worklet or ScriptProcessor')
 assert.deepEqual(await js("window.__requests.at(-1)"),{audio:{deviceId:{exact:'fixture-usb'},echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},video:false})
 assert.deepEqual(await js("window.__analysers.map(a=>({fftSize:a.fftSize,smoothing:a.smoothingTimeConstant}))"),[{fftSize:2048,smoothing:.7}])
 assert.equal(await js("document.querySelectorAll('.secondary-volume-bars>i').length"),14)
 await until("document.querySelectorAll('.secondary-volume-bars>i.active').length===4")
 await js("window.__gains.forEach(g=>g.gain.value=.2)")
 await until("document.querySelector('.secondary-volume-bars').getAttribute('aria-valuenow')==='14'&&document.querySelectorAll('.secondary-volume-bars>i.active').length===8")
 for(const locale of ['en','zh-CN']){
  const requests=await js('window.__requests.length')
  await js(`window.sayrel.invoke('store:use','patch',{language:${JSON.stringify(locale)},soundVolume:.5})`)
  await until(`document.documentElement.lang==='${locale}'`)
  assert.equal(await js('window.__requests.length'),requests,'unrelated settings do not reopen the microphone')
  await shotOnboarding('onboarding-microphone-'+locale)
 }
 await js("window.__gains.forEach(g=>g.gain.value=0)")
 await until("document.querySelector('.secondary-volume-bars').getAttribute('aria-valuenow')==='0'&&document.querySelectorAll('.secondary-volume-bars>i.active').length===0")
 await shotOnboarding('onboarding-microphone-silent')
 await js(`document.querySelector('${setupContinue}').click()`)
 await until("!!document.querySelector('.secondary-keyboard-panel')");await until(released)
 await js("document.querySelector('.secondary-onboarding-back button').click()")
 await until(readyMic)
 console.log('PASS onboarding selected device, original RMS scale, silence, language and no PCM pipeline')
 // Device settings broadcasts switch this preview, including cancellation of a pending open.
 await js("window.__pause=true;window.sayrel.invoke('store:use','patch',{micDevice:'fixture-built-in'})")
 await until("window.__pendingStreams.length===1");await until(released)
 assert.equal(await js(`document.querySelector('${setupContinue}').disabled`),true)
 await js("window.__pause=false;window.sayrel.invoke('store:use','patch',{micDevice:null})")
 await until(readyMic)
 assert.equal(await js("window.__requests.at(-1).audio.deviceId"),undefined)
 const streamsBeforeLate=await js('window.__streams.length')
 await js("window.__pendingStreams.shift()()")
 await until(`window.__streams.length===${streamsBeforeLate+1}&&window.__streams.at(-1).getTracks().every(t=>t.readyState==='ended')`)
 assert.equal(await js("window.__streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length"),1)
 await leaveMicrophone();await until(released)
 // Leaving while opening, then re-entering, must not publish readiness from the old attempt.
 await js("window.__pause=true");await enterMicrophone();await until("window.__pendingStreams.length===1")
 assert.equal(await js(`document.querySelector('${setupContinue}').disabled`),true)
 await leaveMicrophone();await js("window.__pause=false");await enterMicrophone();await until(readyMic)
 await js("window.__pendingStreams.shift()()")
 await until("window.__streams.at(-1).getTracks().every(t=>t.readyState==='ended')")
 assert.equal(await js("window.__streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length"),1)
 await leaveMicrophone();await until(released)
 // Resume gates readiness. Stop releases acquired resources without waiting for resume to settle.
 await js("window.__pauseResume=true");await enterMicrophone();await until("window.__pendingResumes.length===1")
 assert.equal(await js(`document.querySelector('${setupContinue}').disabled`),true)
 assert.equal(await js("document.querySelector('.secondary-volume-bars').getAttribute('aria-valuenow')"),'0')
 await js("window.__pauseResume=false;window.__pendingResumes.shift()()")
 await until(readyMic)
 await leaveMicrophone();await until(released)
 await js("window.__pauseResume=true");await enterMicrophone();await until("window.__pendingResumes.length===1")
 await leaveMicrophone();await until(released)
 await js("window.__pauseResume=false");await enterMicrophone();await until(readyMic)
 await js("window.__pendingResumes.shift()()")
 assert.equal(await js(`document.querySelector('${setupContinue}').disabled`),false)
 assert.equal(await js("window.__streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length"),1)
 await leaveMicrophone();await until(released)
 await dismissToasts()
 await js("window.__pause=true");await enterMicrophone();await until("window.__pendingStreams.length===1")
 await leaveMicrophone();await js("window.__pause=false");await enterMicrophone();await until(readyMic)
 await js("window.__pendingStreams.shift()(true)")
 await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))")
 assert.equal(await js("!!document.querySelector('.sayrel-toast.is-error')"),false,'a cancelled open failure does not report an error in the new preview')
 assert.equal(await js(`document.querySelector('${setupContinue}').disabled`),false)
 await leaveMicrophone();await until(released)
 console.log('PASS onboarding device changes, pending exit, resume gating and stale completion isolation')
 for(const failure of ['denied','missing','constructor','analyser','source','resume']){
  await dismissToasts()
  await js(`window.__reject=${failure==='denied'};window.__missing=${failure==='missing'};window.__failAudio=${JSON.stringify(failure)}`)
  await enterMicrophone()
  await until("[...document.querySelectorAll('.sayrel-toast.is-error')].some(t=>t.textContent.includes('麦克风不可用'))")
  await until(released)
  assert.equal(await js(`document.querySelector('${setupContinue}').disabled`),true)
  assert.equal(await js("document.querySelector('.secondary-volume-bars').getAttribute('aria-valuenow')"),'0')
  await leaveMicrophone()
  await js("window.__reject=false;window.__missing=false;window.__failAudio=null")
  await enterMicrophone();await until(readyMic);await leaveMicrophone();await until(released)
 }
 assert.deepEqual(await js('window.__pcm'),[])
 assert.equal(await js("window.__calls.some(c=>['recording-machine:start','recording-machine:status','audio:ai-voice-flow','audio:opus-compress-by-buffer','db:history-upsert','db:history-save-audio','db:history-upsert-client-metadata','db:history-upsert-mode-meta'].includes(c[0]))"),false)
 assert.equal(await js("window.__trackStops.every(record=>record.count===1)"),true,'onboarding cleanup stops every acquired track exactly once')
 console.log('PASS onboarding permission/device/Web Audio failures clean up and retry without transcription or history')
 assert.deepEqual(errors,[])
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({comparisons,shots,errors,scope:'Settings dialog and onboarding previews in the real renderer, with synthetic streams and real Web Audio; original settings layout comparison. No physical microphone, native permission changes or provider calls.'},null,2))
 console.log('PASS switching, silence, denial, active-recording guard, late stream cleanup and empty state')
}).catch(error=>{console.error(error);console.error(errors);process.exitCode=1}).finally(()=>{win?.destroy();reference?.destroy();app.exit(process.exitCode||0)})
app.on('quit',()=>{try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:3})}catch{}})
