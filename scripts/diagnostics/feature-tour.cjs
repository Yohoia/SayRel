// Production React bundle; isolated IPC and profile. Never captures audio or contacts a provider.
const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const root=resolve(__dirname,'../..'), output=join(root,'docs/ui-evidence/feature-tour',process.env.SAYREL_TOUR_RUN||'current')
const profile=mkdtempSync(join(tmpdir(),'sayrel-tour-'))
app.setPath('userData',profile)
let win
const errors=[],checks=[]
const js=expression=>win.webContents.executeJavaScript(expression)
async function until(expression) { for(let i=0;i<100;i++){if(await js(expression))return;await new Promise(r=>setTimeout(r,40))}throw new Error('Timed out: '+expression) }
async function click(selector) { await js(`document.querySelector(${JSON.stringify(selector)}).click()`) }
async function shot(name) {
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))')
  await js('document.fonts.ready')
  await js('Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>null))).then(()=>true)')
  assert.equal(await js('document.documentElement.scrollWidth>innerWidth'),false,name+' no horizontal page overflow')
  assert.equal(await js("(() => {const r=document.querySelector('.feature-tour>.modal-backdrop>.modal-card').getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"),true,name+' dialog fits viewport')
  writeFileSync(join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());checks.push(name);console.log('PASS '+name)
}
async function step(kind) { await until(`document.querySelector('.tour-step')?.dataset.step===${JSON.stringify(kind)}`) }
async function next() { await js("[...document.querySelectorAll('.tour-copy footer button,.tour-intro>.tour-button')].at(-1).click()") }
app.whenReady().then(async()=>{
  mkdirSync(output,{recursive:true})
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}))
  win=new BrowserWindow({width:1080,height:750,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}})
  win.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message)})
  await win.loadURL('about:blank');win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__tourCalls=[];window.__tourListeners=new Map();window.__target=null;
    window.__emit=(channel,value)=>{for(const cb of window.__tourListeners.get(channel)||[])cb(value)};
    window.__phase=phase=>window.__emit('recording-machine:state',{phase,context:{sessionId:phase==='recording'?'practice-fixture':null,mode:window.__target?.mode,handsFree:true,error:null,issue:null}});
    window.__complete=text=>{window.__phase('idle');window.__emit('feature-tour:result',{targetId:window.__target.id,transcript:'fixture spoken words',text})};
    Object.defineProperty(window,'sayrel',{configurable:true,get(){return this.__tourBridge},set(value){
      const invoke=value.invoke.bind(value),on=value.on.bind(value);
      value.on=(channel,cb)=>{const listeners=window.__tourListeners.get(channel)||new Set();listeners.add(cb);window.__tourListeners.set(channel,listeners);const off=on(channel,cb);return()=>{listeners.delete(cb);off()}};
      value.invoke=async(channel,...args)=>{
        window.__tourCalls.push([channel,...args]);
        if(channel==='feature-tour:set-target'){window.__target=args[0];return true}
        if(channel==='feature-tour:block'){window.__target=null;return true}
        if(channel==='feature-tour:start'){if(!window.__target)throw new Error('Missing target');window.__phase('recording');return true}
        if(channel==='feature-tour:finish'){window.__phase('finishing');return true}
        if(channel==='keyboard:begin-shortcut-capture')return {native:true};
        return invoke(channel,...args)
      };this.__tourBridge=value;
    }});
  `})
  await win.loadFile(join(root,'.build/ui-review/hub.html'),{hash:'/dashboard'})
  await until("!!document.querySelector('.home-settings')")
  await click('.home-settings')
  await until("!!document.querySelector('.settings-modal')")
  await js("[...document.querySelectorAll('.settings-nav-item')].find(b=>b.textContent==='Help').click()")
  await js("[...document.querySelectorAll('.settings-content button')].find(b=>b.textContent==='Start').click()")
  await until("document.querySelectorAll('.tour-feature-card').length===3")
  await shot('picker-english')
  for(const [feature,shortcut,count] of [['dictate','Fn',4],['translate','Fn+Shift',1],['askAnything','Fn+Space',3]]){
    const index=['dictate','translate','askAnything'].indexOf(feature)
    await js(`document.querySelectorAll('.tour-feature-card>.tour-button')[${index}].click()`)
    await step('intro');await shot(feature+'-intro')
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
    assert.equal(await js("document.querySelector('.tour-step').dataset.step"),'intro','Escape does not exit a full-screen course')
    await next();await step('shortcut')
    await until("window.__tourCalls.some(c=>c[0]==='keyboard:begin-shortcut-capture')")
    const starts=await js("window.__tourCalls.filter(c=>c[0]==='feature-tour:start').length")
    await js(`window.__emit('keyboard:shortcut-captured',{combination:${JSON.stringify(shortcut)},pressed:true})`)
    await until("!!document.querySelector('.tour-shortcut-visual.is-pressed')")
    await shot(feature+'-shortcut-pressed')
    await js(`window.__emit('keyboard:shortcut-captured',{combination:${JSON.stringify(shortcut)},pressed:false})`)
    assert.equal(await js("window.__tourCalls.filter(c=>c[0]==='feature-tour:start').length"),starts,'shortcut test never opens microphone')
    await next()
    if(feature==='translate'){
      await step('languages');await shot('translation-languages')
      await click('.tour-language-card .settings-picker')
      await until("!!document.querySelector('.settings-language-list')")
      await click('.settings-add')
      await until("!!document.querySelector('.settings-language-search [role=option]')")
      await click('.settings-language-search [role=option]')
      await until("document.querySelectorAll('.settings-language-item').length===2")
      await js("[...document.querySelectorAll('.settings-subdialog .modal-close')].at(-1).click()")
      await next()
    }
    for(let example=0;example<count;example++){
      await step('example');await until("!!window.__target")
      const target=await js('window.__target')
      assert.equal(target.kind,feature==='dictate'?'dictation':feature==='translate'?'translation':example===0?'rewrite':'question')
      if(feature==='askAnything'&&example<2)assert.ok(target.selectedText.length>0,'selected text is passed to real processing target')
      await shot(feature+'-example-'+(example+1))
      await click('.tour-copy footer button')
      await until("document.querySelector('.tour-copy footer button').textContent==='Finish'")
      await click('.tour-copy footer button')
      await until("document.querySelector('.tour-copy footer button').textContent==='Thinking'")
      assert.equal(await js("document.querySelector('.tour-copy footer .is-primary').disabled"),true,'cannot advance during processing')
      await js(`window.__complete(${JSON.stringify('Provider result for '+feature+' '+example)})`)
      await until("document.querySelector('.tour-practice').dataset.completed==='true'")
      if(feature!=='askAnything'||example===0)assert.match(await js("document.querySelector('.tour-playground textarea').value"),/Provider result/)
      else assert.match(await js("document.querySelector('.tour-answer').textContent"),/Provider result/)
      await shot(feature+'-result-'+(example+1))
      await next()
    }
    await step('done');await shot(feature+'-done')
    assert.equal(await js('window.__target'),null,'completion clears practice routing')
    await click('.tour-done>.tour-button')
    await until("!!document.querySelector('.tour-feature-cards')")
  }
  await js("window.sayrel.invoke('store:use','patch',{language:'zh-CN'})")
  await until("document.querySelector('.feature-tour .modal-card>h2').textContent==='探索关键功能'")
  await shot('picker-chinese')
  win.setContentSize(988,685);await shot('picker-minimum')
  await js("document.querySelector('.tour-feature-card>.tour-button').click()")
  await step('intro');await next();await step('shortcut');await next();await step('example')
  await shot('practice-chinese-minimum')
  await click('.tour-exit');await until("!!document.querySelector('.tour-feature-cards')")
  assert.equal(await js('window.__target'),null,'exit clears current target')
  await click('.feature-tour>.modal-backdrop>.modal-card>.modal-close')
  await until("!document.querySelector('.feature-tour')")
  assert.equal(await js("!!document.querySelector('.settings-modal')"),true,'closing explorer returns to Help')
  assert.equal(await js("window.__tourCalls.some(c=>c[0]==='page:set-hub-window-button-visibility'&&c[1]===false)&&window.__tourCalls.some(c=>c[0]==='page:set-hub-window-button-visibility'&&c[1]===true)"),true,'native window controls restored')
  assert.deepEqual(errors,[])
  writeFileSync(join(output,'report.json'),JSON.stringify({checks,errors,scope:'Actual React UI bundle with isolated practice IPC; no real microphone, credentials, provider requests, pasteboard or user settings.'},null,2))
  console.log('PASS all three complete courses, native shortcut feedback, languages, routed results, navigation and cleanup')
}).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{win?.destroy();app.exit(process.exitCode||0)})
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}))
