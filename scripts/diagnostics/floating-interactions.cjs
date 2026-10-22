// Real renderer and native HubWindow navigation; isolated profile, no hardware or network.
const { app, BrowserWindow, session, ipcMain } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '../..')
const output = join(root, 'docs/ui-evidence/floating-interactions')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-floating-'))
const runtime = join(root, '.build/floating-runtime')
const errors = [], checks = []
let win, hub
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const js = code => win.webContents.executeJavaScript(code)
async function until(expression, target = win) {
  for (let i = 0; i < 120; i++) {
    if (await target.webContents.executeJavaScript(expression)) return
    await wait(40)
  }
  console.error('NAVIGATION STATE', await target.webContents.executeJavaScript('({url:location.href,text:document.body.innerText.slice(0,800)})'))
  throw new Error('Timed out: ' + expression)
}
function load(file, imports, directory = __dirname) {
  const result = {}
  const code = ts.transpileModule(readFileSync(join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { exports: result, require: id => imports[id] ?? require(id), __dirname: directory, process, console, setTimeout, clearTimeout })
  return result
}
const setupIssue = service => ({ kind: 'provider-setup', service, message: 'Configure a default model.' })
async function state(phase, patch = {}) {
  await js(`window.__publish({phase:${JSON.stringify(phase)},context:${JSON.stringify({ sessionId: null, mode: 'voice_transcript', handsFree: false, error: null, issue: null, ...patch })}})`)
  const status = phase === 'starting' ? 'starting-microphone' : phase === 'finishing' ? patch.handsFree ? 'hands-free-dictating' : 'recording-dictating' : phase === 'recording' && patch.handsFree ? 'hands-free' : phase === 'idle' ? 'idle-hidden' : phase
  await until(`document.querySelector('[data-testid="floating-bar"]').dataset.status===${JSON.stringify(status)}`)
}
async function settled() {
  await js('document.fonts.ready')
  await js('Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>null))).then(()=>true)')
}
async function shot(name) {
  await settled()
  assert.equal(await js('document.documentElement.scrollWidth>innerWidth'), false, name + ' horizontal overflow')
  assert.equal(await js("(() => {const a=document.querySelector('.floating-alert');if(!a)return true;const r=a.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=document.querySelector('[data-testid=floating-bar]').getBoundingClientRect().top})()"), true, name + ' alert fits above the bar')
  writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
  checks.push(name)
  console.log('PASS ' + name)
}
app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true })
  mkdirSync(join(runtime, 'main'), { recursive: true })
  if (!existsSync(join(runtime, 'renderer'))) symlinkSync(join(root, '.build/ui-review'), join(runtime, 'renderer'), 'dir')
  const preload = join(runtime, 'preload.cjs')
  writeFileSync(preload, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('__floatingTest',{openHub:route=>ipcRenderer.invoke('verify-floating:open-hub',route)});")
  const base = load('src/main/windows/base.ts', {}, join(runtime, 'main'))
  base.setPreloadPath(preload)
  const { HubWindow } = load('src/main/windows/hub.ts', { './base': base, '../../shared/constants': { WINDOWS: { HUB: 'hub.html' } }, '../lib/logger': { createLogger: () => ({ warn: (...args) => errors.push(args) }) } })
  hub = new HubWindow()
  hub.shouldShowOnReady = () => false
  ipcMain.handle('verify-floating:open-hub', (_, route) => { hub.setRoute(route); hub.createWindow(); return true })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }))
  win = new BrowserWindow({ width: 750, height: 500, useContentSize: true, show: false, webPreferences: { preload, backgroundThrottling: false } })
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message) })
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__calls=[];window.__subscribers=new Map();window.__current={phase:'idle',context:{sessionId:null,handsFree:false}};
    window.__publish=state=>{window.__current=state;for(const cb of window.__subscribers.get('recording-machine:state')||[])cb(state)};
    Object.defineProperty(window,'sayrel',{configurable:true,get(){return this.__bridge},set(value){
      const invoke=value.invoke.bind(value),on=value.on.bind(value);
      value.on=(channel,cb)=>{const set=window.__subscribers.get(channel)||new Set();set.add(cb);window.__subscribers.set(channel,set);const off=on(channel,cb);return()=>{set.delete(cb);off()}};
      value.invoke=async(channel,...args)=>{
        window.__calls.push([channel,...args]);
        if(channel==='recording-machine:state')return window.__current;
        if(channel==='page:open-hub'){if(window.__failOpen)throw new Error('fixture open failure');return window.__floatingTest.openHub(args[0])}
        if(channel==='page:floating-bar-click'){
          if(args[0]==='cancel')window.__publish({phase:'idle',context:{sessionId:null,handsFree:false,issue:null}});
          if(args[0]==='retry')window.__publish({phase:'finishing',context:{sessionId:'retry-fixture',handsFree:false,issue:null}});
        }
        return invoke(channel,...args);
      };
      this.__bridge=value;
    }});
  ` })
  await win.loadFile(join(root, '.build/ui-review/floating-bar.html'))
  await until("!!document.querySelector('[data-testid=floating-bar]')")
  await js("window.sayrel.invoke('store:use','patch',{language:'zh-CN'})")
  await until("document.documentElement.lang==='zh-CN'")
  await state('error', { error: 'Configure a default model.', issue: setupIssue('transcription') })
  await until("document.querySelector('.floating-alert')?.dataset.issue==='provider-setup'")
  assert.equal(await js("document.querySelector('.floating-alert-primary').textContent"), '去配置')
  assert.equal(await js("window.__calls.some(c=>c[0]==='recording-machine:status'&&['started','chunk'].includes(c[1]))"), false, 'setup error never starts the microphone')
  await shot('provider-setup-chinese')
  await until("(() => {const a=document.querySelector('.floating-alert').getBoundingClientRect(),b=document.querySelector('[data-testid=floating-bar]').getBoundingClientRect(),regions=window.__calls.filter(c=>c[0]==='page:floating-bar-update-positions').at(-1)?.[1]||[];return [a,b].every(r=>regions.some(p=>window.screenX+r.left>=p.left-1&&window.screenX+r.right<=p.right+1&&window.screenY+r.top>=p.top-1&&window.screenY+r.bottom<=p.bottom+1))})()")
  await js('window.__failOpen=true;document.querySelector(".floating-alert-primary").click()')
  await until("!!document.querySelector('.floating-alert-action-error')")
  assert.equal(await js("!!document.querySelector('.floating-alert')"), true, 'failed action retains the alert')
  await shot('provider-open-failed')
  await js('window.__failOpen=false;document.querySelector(".floating-alert-primary").click()')
  await until("!document.querySelector('.floating-alert')")
  await until("location.hash==='#/providers'&&!!document.querySelector('.providers-page')", hub.getWindow())
  hub.setRoute('/dashboard')
  await until("!!document.querySelector('.home-headline')", hub.getWindow())
  await state('error', { error: 'Configure a default model.', issue: setupIssue('refinement') })
  await js("document.querySelector('.floating-alert-primary').click()")
  await until("!document.querySelector('.floating-alert')")
  await until("location.hash==='#/providers'&&!!document.querySelector('.providers-page')", hub.getWindow())
  checks.push('setup action opens Providers in both new and existing hub windows')
  await state('error', { error: 'Microphone unavailable. Check system permissions and try again.', issue: { kind: 'microphone', message: 'Microphone unavailable. Check system permissions and try again.' } })
  await shot('microphone-alert')
  await js("document.querySelector('.floating-alert-primary').click()")
  await until("!document.querySelector('.floating-alert')")
  await until("location.hash==='#/settings'&&!!document.querySelector('.settings-page')", hub.getWindow())
  checks.push('microphone action opens the audio settings page')
  await state('error', { error: 'Check your connection and try again.', issue: { kind: 'processing', message: 'Check your connection and try again.', canRetry: true } })
  await shot('retry-alert')
  await js("document.querySelector('.floating-alert-primary').click()")
  await until("document.querySelector('[data-testid=floating-bar]').dataset.status==='recording-dictating'")
  assert.equal(await js("window.__calls.some(c=>c[0]==='page:floating-bar-click'&&c[1]==='retry')"), true, 'retry reuses the recording')
  await state('starting')
  await shot('starting-microphone')
  for (const handsFree of [false,true]) {
    await state('recording', { handsFree, recorderTimeoutState: { remainingTime: 25, timeUntilCountdown: 0 } })
    await shot(handsFree ? 'hands-free-countdown' : 'recording-countdown')
    assert.equal(await js("getComputedStyle(document.querySelector('[data-testid=floating-bar]')).width"), handsFree ? '156px' : '110px')
    if(handsFree) {
      await js("document.querySelectorAll('.floating-action')[1].click()")
      assert.equal(await js("window.__calls.some(c=>c[0]==='page:floating-bar-click'&&c[1]==='finish')"), true)
    }
    await state('finishing', { handsFree })
    await shot(handsFree ? 'hands-free-processing' : 'processing')
    assert.equal(await js("getComputedStyle(document.querySelector('[data-testid=floating-bar]')).width"), handsFree ? '116px' : '82px')
    if(handsFree) assert.equal(await js("[...document.querySelectorAll('.floating-action')].every(b=>b.disabled)&&document.querySelectorAll('.floating-action').length===2"), true, 'hands-free processing preserves disabled controls')
  }
  await state('recording', { handsFree: true })
  await js("document.querySelector('.floating-action').click()")
  await until("document.querySelector('[data-testid=floating-bar]').dataset.status==='idle-hidden'")
  await state('error', { error: 'Configure a default model.', issue: setupIssue('transcription') })
  await js("document.querySelector('.floating-alert-close').click()")
  await until("!document.querySelector('.floating-alert')")
  checks.push('dismiss and cancel return to idle')
  await state('error', { error: 'Configure a default model.', issue: setupIssue('transcription') })
  win.setContentSize(360,320)
  await shot('provider-setup-narrow')
  win.setContentSize(750,500)
  await js("window.sayrel.invoke('store:use','patch',{language:'en'})")
  await until("document.documentElement.lang==='en'")
  await shot('provider-setup-english')
  assert.deepEqual(errors, [])
  writeFileSync(join(output,'report.json'),JSON.stringify({checks,errors,scope:'Isolated production UI bundle with fixture IPC, real HubWindow/BaseWindow navigation, no real microphone, provider requests or user profile'},null,2))
  console.log('PASS alert hit regions, recovery actions, navigation, cancel and complete recorder states')
}).catch(error => { console.error(error);process.exitCode=1 }).finally(() => {
  ipcMain.removeHandler('verify-floating:open-hub')
  hub?.getWindow()?.destroy()
  win?.destroy()
  app.exit(process.exitCode || 0)
})
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}))
