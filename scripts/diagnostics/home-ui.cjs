// Isolated Electron UI check: no real profile, microphone, providers or external navigation.
const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '../..')
const output = join(root, 'docs/ui-evidence/home')
const profile = mkdtempSync(join(tmpdir(), 'offkey-home-'))
const reports = [], errors = []
let win
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(expression) {
  for (let i = 0; i < 100; i++) { if (await win.webContents.executeJavaScript(expression)) return; await wait(50) }
  throw new Error('Timed out: ' + expression)
}
const js = code => win.webContents.executeJavaScript(code)
async function shot(name) {
  await wait(300)
  const state = await js(`({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,missing:[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src),text:document.querySelector('.home-canvas')?.innerText})`)
  assert.equal(state.overflow, false, name)
  assert.equal(await js(`(() => { const composition=document.querySelector('.home-composition'),apps=document.querySelector('.home-applications');return !composition||!apps||composition.getBoundingClientRect().bottom<=apps.getBoundingClientRect().top+1 })()`),true,name+' overlapping sections')
  assert.deepEqual(state.missing, [], name)
  writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
  reports.push({ name, ...state })
  console.log('PASS ' + name)
}
async function load(query = {}) {
  console.log('LOAD',query); await win.loadFile(join(root, '.build/ui-review/hub.html'), { query, hash: '/dashboard' })
  await until("document.querySelector('.home-usage')?.innerText.includes('分钟')")
}
app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }))
  win = new BrowserWindow({ width:1080, height:750, useContentSize:true, show:false, webPreferences:{ backgroundThrottling:false } })
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message) })
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3'); console.log('debugger attached'); await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__homeCalls = []; window.__homeSubscribers = new Map(); window.__homeFail = false;
    Object.defineProperty(window, 'offkey', { configurable:true, get(){return this.__homeBridge}, set(value){
      const invoke=value.invoke.bind(value), on=value.on.bind(value);
      value.invoke=async(channel,...args)=>{window.__homeCalls.push([channel,...args]);if(channel==='db:history-list'&&window.__homeFail)throw new Error('fixture history failure');return invoke(channel,...args)};
      value.on=(channel,cb)=>{const listeners=window.__homeSubscribers.get(channel)||new Set();listeners.add(cb);window.__homeSubscribers.set(channel,listeners);const off=on(channel,cb);return()=>{listeners.delete(cb);off()}};
      this.__homeBridge=value;
    }});
  ` })
  console.log('hook ready'); await load()
  await shot('home-default')
  const usage = await js("document.querySelector('.home-usage').innerText")
  assert.match(usage, /2.*分钟/s)
  assert.match(usage, /56.*字/s)
  for (const phase of ['recording','finishing','error','unavailable','idle']) {
    await js(`window.__homeSubscribers.get('recording-machine:state').forEach(cb=>cb({phase:${JSON.stringify(phase)}}))`)
    await until(`document.querySelector('.home-canvas').dataset.recordingPhase===${JSON.stringify(phase)}`)
    await shot('status-' + phase)
  }
  await js("document.querySelectorAll('.home-shortcut')[1].focus(); document.querySelectorAll('.home-shortcut')[1].click()")
  await until("!!document.querySelector('.settings-modal')")
  await shot('shortcut-settings')
  await js("document.querySelector('.settings-modal-close').click()")
  await until("!document.querySelector('.settings-modal')")
  assert.equal(await js("document.activeElement.classList.contains('home-shortcut')"), true, 'settings restores focus')
  await js("window.offkey.invoke('store:use','patch',{shortcut:{accelerator:'Control+K',enabled:true},translationShortcut:{accelerator:'Shift+Fn',enabled:false}})")
  await until("document.querySelectorAll('.home-shortcut')[0].innerText.includes('Control') && document.querySelectorAll('.home-shortcut')[1].innerText.includes('已停用')")
  await shot('changed-shortcuts')
  await js("document.querySelectorAll('.home-stamp')[2].click()")
  await until("window.__homeCalls.some(c=>c[0]==='page:open-url' && c[1]==='https://chatgpt.com/')")
  for (const route of ['history','dictionary','providers']) {
    await js(`document.querySelector('.home-navigation a[href="#/${route}"]').click()`)
    await until(`!!document.querySelector('.${route}-page')`)
    await js("document.querySelector('.home-navigation a[href=\"#/dashboard\"]').click()")
    await until("!!document.querySelector('.home-canvas')")
    assert.equal(await js("!!document.querySelector('.app-sidebar')"), false)
  }
  await js("window.__homeFail=true; window.dispatchEvent(new Event('focus'))")
  await until("document.querySelector('.home-usage').innerText.includes('统计暂不可用')")
  await shot('usage-error')
  await js("window.__homeFail=false; document.querySelector('.home-usage button').click()")
  await until("document.querySelector('.home-usage').innerText.includes('分钟')")
  await shot('usage-recovered')
  await js("document.querySelector('.home-version button').click()")
  await until("document.querySelector('.home-version button').disabled")
  await until("!document.querySelector('.home-version button').disabled")
  assert.equal(await js("window.__homeCalls.some(c=>c[0]==='updater:check-for-update')"), true)
  await js("window.offkey.invoke('store:use','patch',{shortcut:{accelerator:'Fn',enabled:true},translationShortcut:{accelerator:'Fn+Shift',enabled:true}})")
  await load({state:'empty'})
  await shot('home-empty')
  assert.match(await js("document.querySelector('.home-usage').innerText"), /0.*分钟.*0.*字.*从一次口述开始/s)
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] })
  await js("window.__homeSubscribers.get('recording-machine:state').forEach(cb=>cb({phase:'recording'}))")
  assert.equal(await js("getComputedStyle(document.querySelector('.home-listening-ring')).animationName"), 'none')
  await shot('reduced-motion')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features:[] })
  await js("window.offkey.invoke('appearance:set-preference','dark')")
  assert.equal(await js("getComputedStyle(document.querySelector('.home-canvas')).backgroundColor"), 'rgb(242, 242, 242)')
  await shot('paper-in-dark-preference')
  await js("window.offkey.invoke('appearance:set-preference','light')")
  win.setContentSize(988,685); await shot('minimum-window')
  win.setContentSize(840,560); await shot('small-window')
  win.setContentSize(600,750); await shot('narrow-window')
  assert.deepEqual(errors, [])
  writeFileSync(join(output,'report.json'), JSON.stringify({reports,errors,checks:['actual navigation and return','settings open and focus return','live shortcut changes and disabled state','application URL forwarding','recording state updates','history failure and retry','empty history','updater pending state','reduced motion','paper in dark preference','1080 / 988 / 840 / 600 widths'],scope:'Offline fixture, temporary profile, network blocked'},null,2))
}).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{win?.destroy();app.exit(process.exitCode||0)})
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}))
