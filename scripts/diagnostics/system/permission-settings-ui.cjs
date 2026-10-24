// Real renderer bundle with isolated permissions, synthetic audio, and a temporary profile.
// Never changes macOS permissions, opens System Settings, or contacts providers.
const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '../../..'), output = join(root, 'docs/ui-evidence/permission-settings')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-permissions-'))
app.setPath('userData', profile)
let win
const errors = [], screenshots = []
const js = expression => win.webContents.executeJavaScript(expression)
async function until(expression) {
  for (let i = 0; i < 150; i++) {
    if (await js(expression)) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error('Timed out: ' + expression)
}
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
async function shot(name) {
  await js('document.fonts.ready')
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))')
  await js('Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>null))).then(()=>true)')
  assert.equal(await js('document.documentElement.scrollWidth>innerWidth'), false, name + ' fits horizontally')
  writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
  screenshots.push(name)
  console.log('PASS ' + name)
}
async function checkSetupMinimum() {
  win.setContentSize(988, 685)
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))')
  assert.equal(await js(`(() => {
    const buttons=[...document.querySelectorAll('.secondary-onboarding-footer button')].map(b=>b.getBoundingClientRect());
    return buttons.every((r,i)=>r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&buttons.every((other,j)=>i===j||r.right<=other.left||r.left>=other.right));
  })()`), true, 'all setup actions fit the minimum window without overlap')
  win.setContentSize(1080, 750)
}
app.whenReady().then(async () => {
  mkdirSync(output, { recursive:true })
  session.defaultSession.webRequest.onBeforeRequest({ urls:['http://*/*','https://*/*'] }, (_, cb) => cb({ cancel:true }))
  win = new BrowserWindow({ width:1080, height:750, useContentSize:true, show:false, webPreferences:{ backgroundThrottling:false } })
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message) })
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled:true })
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source:`
    if(location.protocol==='file:')localStorage.setItem('sayrel-ui-settings',JSON.stringify({language:'zh-CN',appearancePreference:'light'}));
    window.__permissions={microphone:false,accessibility:false,screenRecording:false};
    window.__calls=[];window.__listeners=new Map();window.__failCheck=false;window.__failRequest=false;
    window.__emit=(channel,value)=>{for(const cb of window.__listeners.get(channel)||[])cb(value)};
    Object.defineProperty(window,'sayrel',{configurable:true,get(){return this.__bridge},set(value){
      const invoke=value.invoke.bind(value),on=value.on.bind(value);
      value.on=(channel,cb)=>{const listeners=window.__listeners.get(channel)||new Set();listeners.add(cb);window.__listeners.set(channel,listeners);const off=on(channel,cb);return()=>{listeners.delete(cb);off()}};
      value.invoke=async(channel,...args)=>{
        window.__calls.push([channel,...args]);
        if(channel==='permission:check-with-child-process'){if(window.__failCheck)throw new Error('fixture check failure');return window.__permissions[args[0]]}
        if(channel==='permission:request'){if(window.__failRequest)throw new Error('fixture request failure');return window.__permissions[args[0]]}
        if(channel==='permission:open-system-preferences'||channel==='page:open-onboarding')return true;
        return invoke(channel,...args)
      };this.__bridge=value;
    }});
  ` })
  await win.loadFile(join(root, '.build/ui-review/hub.html'))
  await until("!!document.querySelector('.home-settings')")
  await click('.home-settings')
  await until("document.querySelectorAll('.settings-permission-status.is-denied').length===3")
  assert.equal(await js("document.querySelector('.settings-group-title').textContent.trim()"), '系统权限')
  assert.equal(await js("document.querySelectorAll('[data-permission] button[role=switch]').length"), 0, 'OS permissions are not simulated app switches')
  await shot('settings-permissions')
  for (const kind of ['microphone', 'accessibility', 'screenRecording']) {
    await click(`[data-permission=${kind}] button`)
    await until(`window.__calls.some(call=>call[0]==='permission:request'&&call[1]==='${kind}')`)
    assert.equal(await js(`document.querySelector('[data-permission=${kind}] .settings-permission-status').textContent`), '未开启')
  }
  await js("window.__permissions={microphone:true,accessibility:true,screenRecording:true};dispatchEvent(new Event('focus'))")
  await until("document.querySelectorAll('.settings-permission-status.is-granted').length===3")
  for (const kind of ['microphone', 'accessibility', 'screenRecording']) {
    await click(`[data-permission=${kind}] button`)
    await until(`window.__calls.some(call=>call[0]==='permission:open-system-preferences'&&call[1]==='${kind}')`)
  }
  await js("window.__permissions.microphone=false;dispatchEvent(new Event('focus'))")
  await until("!!document.querySelector('[data-permission=microphone] .is-denied')")
  await js("window.__failCheck=true;dispatchEvent(new Event('focus'))")
  await until("document.querySelectorAll('.settings-permission-status.is-error').length===3")
  await js('window.__failRequest=true')
  await click('[data-permission=microphone] button')
  await until("document.querySelector('.toast-message[role=alert]')?.textContent==='无法打开权限设置，请重试。'")
  await js("window.__failRequest=false;window.__failCheck=false;dispatchEvent(new Event('focus'))")
  await until("document.querySelectorAll('.settings-permission-status.is-granted').length===2")
  console.log('PASS permission request, management, grant/revoke refresh, and failure recovery')
  await js("document.querySelectorAll('.sayrel-toast').forEach(node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))")
  await until("document.querySelectorAll('.sayrel-toast').length===0")
  await js("window.sayrel.invoke('appearance:set-preference','dark')")
  await shot('settings-permissions-dark')
  win.setContentSize(800, 685)
  await shot('settings-permissions-narrow')
  assert.equal(await js("document.querySelector('.settings-content').scrollWidth>document.querySelector('.settings-content').clientWidth"), false)
  win.setContentSize(1080, 750)
  await js("window.sayrel.invoke('appearance:set-preference','light')")
  await click('.settings-nav-item:last-child')
  await until("document.body.innerText.includes('重新打开引导')")
  await js("[...document.querySelectorAll('.settings-pill')].find(b=>b.textContent==='重新打开引导').click()")
  assert.equal(await js("window.__calls.filter(c=>c[0]==='page:open-onboarding').length"), 1)
  await shot('settings-reopen-onboarding')

  await win.loadFile(join(root, '.build/ui-review/onboarding.html'))
  await until("!!document.querySelector('.secondary-permission-allow')")
  await shot('onboarding-01-permissions')
  await checkSetupMinimum()
  assert.equal(await js("!!document.querySelector('.secondary-onboarding-footer .secondary-primary-button')"), false, 'permissions required before continuing')
  await click('.secondary-onboarding-later')
  assert.equal(await js("window.__calls.filter(c=>c[0]==='page:complete-onboarding').length"), 1, 'setup can be deferred without any permission')
  assert.equal(await js("window.__calls.filter(c=>c[0]==='permission:request').length"), 0, 'deferring never requests permission')
  await js("window.__permissions.accessibility=true;dispatchEvent(new Event('focus'))")
  await until("document.querySelectorAll('.secondary-permission-allow').length===1")
  await shot('onboarding-01-microphone-permission')
  await js("window.__permissions.microphone=true;dispatchEvent(new Event('focus'))")
  await until("!!document.querySelector('.secondary-onboarding-footer .secondary-primary-button')")
  await click('.secondary-onboarding-footer .secondary-primary-button')
  await until("!!document.querySelector('.secondary-volume-bars')&&!document.querySelector('.secondary-onboarding-footer .secondary-primary-button').disabled")
  await shot('onboarding-02-microphone')
  await checkSetupMinimum()
  await click('.secondary-onboarding-footer .secondary-primary-button')
  await until("!!document.querySelector('.secondary-keyboard-panel')")
  await shot('onboarding-03-shortcut')
  await checkSetupMinimum()
  assert.equal(await js("document.querySelector('.secondary-onboarding-footer .secondary-primary-button').disabled"), true)
  await js("window.__emit('recording-machine:state',{phase:'starting',context:{mode:'voice_transcript'}})")
  await until("!document.querySelector('.secondary-onboarding-footer .secondary-primary-button').disabled")
  await click('.secondary-onboarding-footer .secondary-primary-button')
  await until("!!document.querySelector('.secondary-onboarding-done')")
  await shot('onboarding-04-done')
  await click('.secondary-onboarding-done .secondary-primary-button')
  assert.equal(await js("window.__calls.filter(c=>c[0]==='page:complete-onboarding').length"), 2)
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'report.json'), JSON.stringify({ screenshots, errors, scope:'Offline renderer; mocked OS permissions and synthetic microphone; no user data or TCC changes' }, null, 2))
}).catch(error => { console.error(error); process.exitCode=1 }).finally(() => {
  win?.destroy()
  try { rmSync(profile, { recursive:true, force:true, maxRetries:5, retryDelay:100 }) }
  catch (error) { console.warn('Temporary profile cleanup:', error.message) }
  app.exit(process.exitCode || 0)
})
