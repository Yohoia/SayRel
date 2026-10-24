// Production renderer, temporary profile, synthetic audio only; all network blocked.
const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path'), { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const root=resolve(__dirname,'../../..'), output=join(root,'docs/ui-evidence/typeless-floating')
const profile=mkdtempSync(join(tmpdir(),'sayrel-typeless-'))
app.setPath('userData',profile)
let win, referenceWindow
const errors=[],shots=[],calls=[],menuComparisons=[]
const js=code=>win.webContents.executeJavaScript(code)
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function until(code){for(let i=0;i<150;i++){if(await js(code))return;await wait(30)}throw new Error('Timed out: '+code)}
async function settle(){await js('document.fonts.ready');await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');await js('Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>null))).then(()=>true)')}
async function shot(name,bar=true){await settle();assert.equal(await js('document.documentElement.scrollWidth>innerWidth'),false);writeFileSync(join(output,name+'.png'),(await win.webContents.capturePage(bar?{x:125,y:260,width:500,height:240}:undefined)).toPNG());shots.push(name);console.log('PASS '+name)}
const preview=(status,mode='voice_transcript')=>js(`dispatchEvent(new CustomEvent('sayrel:ui-review-floating-bar',{detail:${JSON.stringify({status,mode})}}))`)
const publish=(phase,patch={})=>js(`window.__emit('recording-machine:state',${JSON.stringify({phase,context:{sessionId:null,mode:'voice_transcript',handsFree:false,...patch}})})`)
const thinkingMeasurement=reference=>`(()=>{
  const pill=document.querySelector('${reference ? '#floating-bar>div' : '[data-testid=floating-bar]'}');
  const text=document.querySelector('${reference ? '#loading>p>span' : '.floating-processing-label>span>span'}');
  const p=pill.getBoundingClientRect(),r=text.getBoundingClientRect();
  const controls=[...document.querySelectorAll('${reference ? '#close button,#done button' : '.floating-action'}')];
  return{width:p.width,height:p.height,textWidth:r.width,left:r.left-p.left,right:p.right-r.right,controls:controls.map(b=>b.getBoundingClientRect().width)};
})()`
const menuGeometry=reference=>`(()=>{
  const trigger=[...document.querySelectorAll('${reference ? 'button[aria-haspopup=true]' : '.floating-language-anchor>button[aria-haspopup=menu]'}')].find(e=>getComputedStyle(e).visibility!=='hidden');
  const menu=document.querySelector('#translation-target-language-popover${reference ? '>div' : ''}');
  const panel=${reference ? 'trigger.parentElement.parentElement' : 'trigger.closest(".floating-translation-panel")'};
  const r=trigger.getBoundingClientRect(),m=menu.getBoundingClientRect(),p=panel.getBoundingClientRect();
  return{triggerWidth:r.width,triggerHeight:r.height,panelWidth:p.width,menuWidth:m.width,menuHeight:m.height,left:m.left-r.left,bottom:m.bottom-r.bottom,
    items:[...menu.querySelectorAll('button')].map(b=>({text:b.textContent,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))};
})()`
function compareGeometry(actual,expected,label){
  for(const [key,value] of Object.entries(expected)){
    if(typeof value==='number')assert.ok(Math.abs(actual[key]-value)<.3,`${label} ${key}: ${actual[key]} vs source ${value}`)
    else assert.deepEqual(actual[key],value,label+' '+key)
  }
}
async function move(selector){const point=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point})}
app.whenReady().then(async()=>{
  mkdirSync(output,{recursive:true})
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}))
  win=new BrowserWindow({width:750,height:500,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}})
  referenceWindow=new BrowserWindow({width:750,height:500,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}})
  referenceWindow.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push('Reference: '+message)})
  await referenceWindow.loadFile(join(root,'.build/typeless-floating/reference-layout.html'))
  await referenceWindow.webContents.executeJavaScript("Promise.all([document.fonts.ready,document.fonts.load('14px MiSans','翻译为英语')]).then(()=>true)")
  await wait(400)
  const referenceThinking=await referenceWindow.webContents.executeJavaScript(thinkingMeasurement(true))
  assert.deepEqual(referenceThinking.controls,[0,0])
  referenceWindow.webContents.debugger.attach('1.3')
  win.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message)})
  await win.loadURL('about:blank');win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__calls=[];window.__listeners=new Map();window.__current={phase:'idle',context:{sessionId:null,handsFree:false}};
    window.__emit=(channel,value)=>{if(channel==='recording-machine:state')window.__current=value;for(const cb of window.__listeners.get(channel)||[])cb(value)};
    Object.defineProperty(window,'sayrel',{configurable:true,get(){return this.__bridge},set(value){
      const on=value.on.bind(value),invoke=value.invoke.bind(value);
      value.on=(channel,cb)=>{const set=window.__listeners.get(channel)||new Set();set.add(cb);window.__listeners.set(channel,set);const off=on(channel,cb);return()=>{set.delete(cb);off()}};
      value.invoke=async(channel,...args)=>{window.__calls.push([channel,...args]);if(channel==='recording-machine:state')return window.__current;return invoke(channel,...args)};this.__bridge=value;
    }});
  `})
  await win.loadFile(join(root,'.build/ui-review/floating-bar.html'))
  await until("!!document.querySelector('[data-testid=floating-bar]')")
  await js("window.sayrel.invoke('store:use','patch',{language:'zh-CN',translationTargetLanguages:['en','ja','zh-CN'],translationTargetLanguage:'en'})")
  await until("document.documentElement.lang==='zh-CN'")
  for(const [status,width,height] of [['hover',70,34],['starting-microphone',54,12],['recording',70,34],['hands-free',116,34],['recording-dictating',92,34]]){
    await preview(status);await settle()
    const box=await js("(()=>{const r=document.querySelector('[data-testid=floating-bar]').getBoundingClientRect(),s=getComputedStyle(document.querySelector('[data-testid=floating-bar]'));return{width:r.width,height:r.height,bottom:r.bottom,radius:s.borderRadius}})()")
    assert.equal(box.width,width,status+' width');assert.equal(box.height,height,status+' height');assert.equal(box.bottom,492);assert.equal(box.radius,'99px')
  }
  await preview('hands-free','translation')
  await until("!!document.querySelector('.floating-language-trigger')")
  await settle()
  assert.equal(await js("document.querySelector('.floating-mode-indicator').getBoundingClientRect().bottom"),450)
  await shot('translation-recording')
  await move('.floating-language-trigger')
  await until("!!document.querySelector('[role=menu]')")
  await until("(()=>{const r=document.querySelector('[role=menu]').getBoundingClientRect(),regions=window.__calls.filter(c=>c[0]==='page:floating-bar-update-positions').at(-1)?.[1]||[];return regions.some(p=>window.screenX+r.left>=p.left-1&&window.screenX+r.right<=p.right+1&&window.screenY+r.top>=p.top-1&&window.screenY+r.bottom<=p.bottom+1)})()")
  assert.equal(await js("document.querySelectorAll('[role=menuitemradio]').length"),3)
  await shot('translation-language-menu')
  for(const [language,selected,targets] of [
    ['zh-CN','en',['en','ja','zh-CN']],['zh-CN','zh-CN',['en','ja','zh-CN']],
    ['en','en',['en','ja','zh-CN']],['en','zh-CN',['en','ja','zh-CN']],['zh-CN','en',['en','ja']]
  ]){
    await js(`window.sayrel.invoke('store:use','patch',${JSON.stringify({language,translationTargetLanguages:targets,translationTargetLanguage:selected})})`)
    await settle()
    await move('.floating-language-anchor>button[aria-haspopup=menu]')
    await until("!!document.querySelector('[role=menu]')")
    await settle()
    await referenceWindow.webContents.executeJavaScript(`renderReference('translation',${JSON.stringify(selected)},${JSON.stringify(language)},${JSON.stringify(targets)})`)
    await referenceWindow.webContents.executeJavaScript('document.fonts.ready');await wait(250)
    const point=await referenceWindow.webContents.executeJavaScript("(()=>{const r=[...document.querySelectorAll('button[aria-haspopup=true]')].find(e=>getComputedStyle(e).visibility!=='hidden').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
    await referenceWindow.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await wait(150)
    const expected=await referenceWindow.webContents.executeJavaScript(menuGeometry(true)),actual=await js(menuGeometry(false))
    compareGeometry(actual,expected,language+' '+selected+' menu')
    menuComparisons.push({language,selected,targets,actual,expected})
    assert.ok(actual.menuWidth>=actual.triggerWidth+10)
  }
  await shot('translation-language-menu-add')
  console.log('PASS five reference-rendered translation menus: short/long labels, English/Chinese, and Add language')
  await js("window.sayrel.invoke('store:use','patch',{language:'zh-CN',translationTargetLanguages:['en','ja','zh-CN'],translationTargetLanguage:'en'})")
  await settle();await move('.floating-language-anchor>button[aria-haspopup=menu]')
  await until("document.querySelectorAll('[role=menuitemradio]').length===3")
  await js("[...document.querySelectorAll('[role=menuitemradio]')].find(b=>b.textContent.includes('日')).click()")
  await until("document.querySelector('.floating-language-anchor>.floating-language-trigger').textContent.includes('日')")
  assert.equal(await js("window.__calls.some(c=>c[0]==='page:floating-bar-click'&&c[1]==='translation-language'&&c[2]==='ja')"),true)
  await js("window.sayrel.invoke('store:use','patch',{translationTargetLanguages:['en','ja']})")
  await move('.floating-language-anchor>.floating-language-trigger')
  await until("!!document.querySelector('[role=menuitem]')")
  await js("document.querySelector('[role=menuitem]').click()")
  assert.equal(await js("window.__calls.some(c=>c[0]==='page:open-settings-modal'&&c[1]==='translation')"),true)
  await js("dispatchEvent(new CustomEvent('sayrel:ui-review-floating-bar',{detail:null}))")
  await publish('recording',{mode:'ask_anything',handsFree:true})
  await until("!!document.querySelector('.floating-ask-indicator')")
  await shot('ask-anything-recording')
  const actions=await js("[...document.querySelectorAll('.floating-action')].map(b=>({width:b.getBoundingClientRect().width,radius:getComputedStyle(b).borderRadius}))")
  assert.deepEqual(actions,[{width:24,radius:'12px'},{width:24,radius:'12px'}])
  await move('.floating-action:last-child')
  await until("!!document.querySelector('.floating-action-tooltip')")
  assert.equal(await js("document.querySelector('.floating-action-tooltip kbd').textContent"),'Fn+Space')
  await shot('ask-anything-finish-tooltip')
  await publish('finishing',{mode:'ask_anything',handsFree:true})
  await until("!!document.querySelector('.floating-progress')")
  await shot('ask-anything-thinking')
  const thinkingGeometry=await js(thinkingMeasurement(false))
  compareGeometry(thinkingGeometry,referenceThinking,'Thinking')
  assert.ok(Math.abs(thinkingGeometry.left-thinkingGeometry.right)<.3,'Thinking text is centered')
  assert.ok(thinkingGeometry.left>12&&thinkingGeometry.right>12,'Thinking text has clear space on both sides')
  for(const mode of ['voice_transcript','translation']){
    await publish('finishing',{mode,handsFree:true});await settle()
    compareGeometry(await js(thinkingMeasurement(false)),referenceThinking,mode+' Thinking after hands-free')
  }
  await publish('idle',{mode:'ask_anything'})
  await until("document.querySelector('[data-testid=floating-bar]').dataset.completing==='true'")
  assert.equal(await js("document.querySelector('.floating-progress>div').style.width"),'100%')
  await wait(180)
  assert.equal(await js("!!document.querySelector('.floating-progress')"),true)
  await until("!document.querySelector('.floating-progress')")
  await until("window.__calls.filter(c=>c[0]==='page:floating-bar-set-expanded').at(-1)?.[1]===false")
  calls.push(...await js('window.__calls'))
  console.log('PASS all mode sizes, language switching, menu hit regions, Fn+Space hint, 350ms completion and window collapse')

  await publish('starting',{sessionId:'synthetic-volume',mode:'ask_anything',handsFree:true})
  await until("window.__calls.some(c=>c[0]==='recording-machine:status'&&c[1]==='started'&&c[2].sessionId==='synthetic-volume')")
  await publish('recording',{sessionId:'synthetic-volume',mode:'ask_anything',handsFree:true})
  await until("Number(document.querySelector('.floating-ask-indicator mask path')?.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g)[5])<90")
  await shot('ask-anything-voice-glow')
  await publish('finishing',{sessionId:'synthetic-volume',mode:'ask_anything',handsFree:true})
  await until("window.__calls.some(c=>c[0]==='recording-machine:status'&&c[1]==='stopped'&&c[2].sessionId==='synthetic-volume')")
  await publish('idle')
  console.log('PASS synthetic microphone drives the real volume glow and drains cleanly')

  win.setContentSize(800,800)
  await win.loadFile(join(root,'.build/ui-review/interactive-card.html'))
  await until("!!document.querySelector('.secondary-card-shell')&&getComputedStyle(document.querySelector('.secondary-card-shell')).opacity==='1'")
  const answer='## 项目安排\n\n把想法整理成 **三个步骤**：\n\n1. 明确目标\n2. 完成实现\n3. 检查效果\n\n| 阶段 | 状态 |\n| --- | --- |\n| 设计 | 已完成 |'
  await js(`window.__emit('interactive-card:update',${JSON.stringify({userPrompt:'请帮我把选中的内容整理成一份简洁的行动计划。',selectedText:'先确认目标，再做实现，最后进行检查。',answer})})`)
  await until("!!document.querySelector('.secondary-card-shell .secondary-answer-content table')")
  await until("getComputedStyle(document.querySelector('.secondary-card-shell')).opacity==='1'")
  const height=await js("window.__calls.filter(c=>c[0]==='page:update-interactive-card-bounds').at(-1)[1].height")
  win.setContentSize(800,Math.min(800,height));await settle()
  const geometry=await js("(()=>{const card=document.querySelector('.secondary-card-shell .secondary-result-card'),s=getComputedStyle(card),answer=card.querySelector('.secondary-answer'),head=answer.querySelector('header'),text=getComputedStyle(answer.querySelector('.secondary-answer-content'));return{width:card.getBoundingClientRect().width,radius:s.borderRadius,padding:s.padding,gap:s.gap,header:head.getBoundingClientRect().height,answerRadius:getComputedStyle(answer).borderRadius,fontSize:text.fontSize,lineHeight:text.lineHeight}})()")
  assert.deepEqual(geometry,{width:744,radius:'16px',padding:'16px',gap:'16px',header:51,answerRadius:'12px',fontSize:'17px',lineHeight:'28px'})
  await shot('ask-anything-result',false)
  await js("document.querySelector('.secondary-card-shell .secondary-answer>header button').click()")
  await until("window.__calls.some(c=>c[0]==='clipboard:write-text')")
  const copied=await js("window.__calls.filter(c=>c[0]==='clipboard:write-text').at(-1)[1]")
  assert.ok(copied.includes('三个步骤')&&!copied.includes('**')&&!copied.includes('##'))
  await js("window.__emit('interactive-card:update',{userPrompt:'A short question',answer:Array.from({length:60},(_,i)=>'Paragraph '+i+' with enough content to fill the reply.').join('\\n\\n')})")
  await until("window.__calls.filter(c=>c[0]==='page:update-interactive-card-bounds').at(-1)[1].height>700")
  assert.equal(await js("document.querySelector('.secondary-card-measure .secondary-result-card').getBoundingClientRect().height"),700)
  await js("window.__emit('interactive-card:update',{userPrompt:'A short question',answer:'A short reply.'})")
  await until("window.__calls.filter(c=>c[0]==='page:update-interactive-card-bounds').at(-1)[1].height===488")
  await js("dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))")
  assert.equal(await js("window.__calls.some(c=>c[0]==='page:close-interactive-card')"),true)
  console.log('PASS card Markdown, plain-text copying, short/long content measurement and Escape')
  win.setContentSize(1080,750)
  await win.loadFile(join(root,'.build/ui-review/hub.html'))
  await until("!!document.querySelector('.home-settings')")
  await js("window.sayrel.invoke('page:open-settings-modal','translation')")
  await until("!!document.querySelector('.settings-language-list')")
  assert.deepEqual(errors,[])
  writeFileSync(join(output,'report.json'),JSON.stringify({shots,geometry,thinkingGeometry,referenceThinking,menuComparisons,errors,calls,scope:'Offline production renderer and extracted reference UI with isolated IPC and synthetic audio; no real OS grants, microphone, provider, or user profile'},null,2))
}).catch(error=>{console.error(error);if(errors.length)console.error(errors);process.exitCode=1}).finally(()=>{win?.destroy();referenceWindow?.destroy();app.exit(process.exitCode||0)})
app.on('quit',()=>{try{rmSync(profile,{recursive:true,force:true,maxRetries:3})}catch{}})
