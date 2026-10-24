// Exercise the shipped editor with isolated IPC adapters; no user profile or native input.
const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '../../..')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-shortcut-capture-'))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
let win
const js = code => win.webContents.executeJavaScript(code)
async function until(code) {
  for (let i = 0; i < 100; i++) {
    if (await js(code)) return
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  throw new Error('Timed out: ' + code)
}
async function open() {
  await js("window.sayrel.invoke('page:open-settings-modal','settings')")
  await until("!!document.querySelector('.settings-shortcuts')")
}
async function begin(group = 0, add = false) {
  const count = await js('window.__captureSequence')
  await js(`document.querySelectorAll('.settings-shortcuts')[${group}].querySelector('${add ? '.settings-add' : '.settings-shortcut-key'}').click()`)
  await until(`window.__captureSequence===${count + 1} && !!document.querySelector('.is-recording')`)
  return count + 1
}
async function emit(combination, pressed, id) {
  await js(`window.__emit({sessionId:${id ?? 'window.__captureSequence'},combination:${JSON.stringify(combination)},pressed:${pressed}})`)
}
async function chord(key, options = {}) {
  await js(`(() => {const target=document.querySelector('.is-recording');for(const type of ['keydown','keyup'])target.dispatchEvent(new KeyboardEvent(type,{key:${JSON.stringify(key)},bubbles:true,cancelable:true,...${JSON.stringify(options)}}))})()`)
}
const stored = () => js("window.sayrel.invoke('store:use','get')")
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }))
  win = new BrowserWindow({ show: false, width: 1080, height: 750, webPreferences: { backgroundThrottling: false } })
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__captureSequence=0;window.__listeners=new Set();window.__calls=[];window.__native=false;window.__pending=false;
    window.__emit=event=>{for(const cb of window.__listeners)cb(event)};
    Object.defineProperty(window,'sayrel',{configurable:true,get(){return this.__bridge},set(value){
      const invoke=value.invoke.bind(value),on=value.on.bind(value);
      value.on=(channel,cb)=>{if(channel==='keyboard:shortcut-captured')window.__listeners.add(cb);const off=on(channel,cb);return()=>{window.__listeners.delete(cb);off()}};
      value.invoke=async(channel,...args)=>{
        window.__calls.push([channel,...args]);
        if(channel==='keyboard:begin-shortcut-capture'){
          const result={native:window.__native,sessionId:++window.__captureSequence};
          if(window.__pending)return new Promise(resolve=>{window.__resolveBegin=()=>resolve(result)});
          return result;
        }
        if(channel==='store:use'&&args[0]==='patch'&&window.__holdSave){
          const result=await invoke(channel,...args);
          return new Promise(resolve=>{window.__resolveSave=()=>resolve(result)});
        }
        return invoke(channel,...args);
      };this.__bridge=value;
    }});
  ` })
  await win.loadFile(join(root, '.build/ui-review/hub.html'), { hash: '/dashboard' })
  await until("!!document.querySelector('.home-settings')")
  await open()

  await js('window.__pending=true')
  const pendingId = await begin()
  await chord('Escape', { code: 'Escape' })
  await until("!document.querySelector('.is-recording')")
  assert.equal(await js("!!document.querySelector('.settings-modal')"), true, 'Escape cancels capture without closing settings')
  await js('window.__pending=false;window.__resolveBegin()')
  await until(`window.__calls.some(c=>c[0]==='keyboard:end-shortcut-capture'&&c[1]===${pendingId})`)
  assert.equal(await js('window.__listeners.size'), 0)
  console.log('PASS Escape during initialization cancels only capture and releases the late session')

  await begin()
  await chord('Alt', { altKey: true, shiftKey: true, code: 'AltLeft' })
  await until("!document.querySelector('.is-recording')")
  assert.equal((await stored()).shortcut.accelerator, 'Alt+Shift', 'Shift held before capture remains in the saved shortcut')
  console.log('PASS browser capture preserves Shift held before editing when saving Alt+Shift')

  await begin()
  await chord('k', { ctrlKey: true, code: 'KeyK' })
  await until("!document.querySelector('.is-recording')")
  assert.equal((await stored()).shortcut.accelerator, 'Control+K')
  assert.match(await js("document.querySelector('.settings-shortcut-key').innerText"), /Control/)
  await begin(0, true)
  await chord('ArrowLeft', { shiftKey: true, code: 'ArrowLeft' })
  await until("!document.querySelector('.is-recording')")
  assert.equal((await stored()).additionalShortcuts.shortcut[0].accelerator, 'Shift+Left')
  console.log('PASS browser chords and arrow keys display and persist through the editor')

  await js('window.__native=true')
  await begin(2)
  await chord('Unidentified')
  await emit('Fn', true)
  await emit('Fn+RightShift', true)
  await emit('Fn+RightShift', false)
  await until("!document.querySelector('.is-recording')")
  assert.equal((await stored()).askAnythingShortcut.accelerator, 'Fn+RightShift')
  assert.match(await js("document.querySelectorAll('.settings-shortcuts')[2].innerText"), /Right Shift/)
  await begin(2)
  await emit('Mouse4', true)
  await emit('Mouse4', false)
  await until("!document.querySelector('.is-recording')")
  assert.equal((await stored()).askAnythingShortcut.accelerator, 'Mouse4')
  console.log('PASS native Fn upgrades, sided modifiers and supported mouse bindings survive capture')

  await js('window.__pending=true')
  const oldId = await begin()
  await js("document.querySelector('.settings-modal-close').click()")
  await until("!document.querySelector('.settings-modal') && window.__listeners.size===0")
  await js('window.__pending=false')
  await open()
  const newId = await begin()
  await js('window.__resolveBegin()')
  await until(`window.__calls.some(c=>c[0]==='keyboard:end-shortcut-capture'&&c[1]===${oldId})`)
  await emit('Control+X', true, oldId)
  await emit('Control+X', false, oldId)
  assert.equal((await stored()).shortcut.accelerator, 'Control+K')
  assert.equal(await js("!!document.querySelector('.is-recording')"), true)
  await emit('Control+Y', true, newId)
  await emit('Control+Y', false, newId)
  await until("!document.querySelector('.is-recording')")
  assert.equal((await stored()).shortcut.accelerator, 'Control+Y')
  console.log('PASS closing during initialization and late events cannot pollute a new edit')

  await js('window.__holdSave=true')
  await begin()
  const saves = await js("window.__calls.filter(c=>c[0]==='store:use'&&c[1]==='patch').length")
  await emit('Control+U', true)
  await emit('Control+U', false)
  await emit('Control+U', false)
  await until('!!window.__resolveSave')
  assert.equal(await js("window.__calls.filter(c=>c[0]==='store:use'&&c[1]==='patch').length"), saves + 1, 'repeated release saves once')
  await js("window.dispatchEvent(new Event('blur'))")
  await until("!document.querySelector('.is-recording') && window.__listeners.size===0")
  await begin()
  await js('window.__holdSave=false;window.__resolveSave()')
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  assert.equal(await js("!!document.querySelector('.is-recording')"), true, 'late save must not close a new edit')
  await js("window.dispatchEvent(new Event('blur'))")
  await until("!document.querySelector('.is-recording') && window.__listeners.size===0")
  console.log('PASS blur releases capture and a late save leaves the next edit open')

  await begin(2)
  await emit('Control+U', true)
  await emit('Control+U', false)
  assert.equal((await stored()).askAnythingShortcut.accelerator, 'Mouse4', 'conflicting binding is not saved')
  assert.equal(await js("!!document.querySelector('.is-recording')"), true, 'conflict leaves editor open to retry')
  await emit('Fn+RightShift', true)
  await emit('Fn+RightShift', false)
  await until("!document.querySelector('.is-recording')")
  await begin()
  await js("document.querySelector('.is-recording').parentElement.querySelector('[aria-label=\"Reset shortcut\"]').click()")
  await until("!document.querySelector('.is-recording')")
  assert.equal((await stored()).shortcut.accelerator, 'Fn')
  for (const combination of ['Control+1', 'Control+2']) {
    await begin(0, true)
    await emit(combination, true)
    await emit(combination, false)
    await until("!document.querySelector('.is-recording')")
  }
  assert.equal(await js("document.querySelector('.settings-shortcuts').querySelectorAll('.settings-shortcut-key').length"), 4)
  assert.equal(await js("!!document.querySelector('.settings-shortcuts').querySelector('.settings-add')"), false, 'cannot add a fifth binding')
  for (let remaining = 3; remaining >= 1; remaining--) {
    await js("document.querySelector('.settings-shortcuts').querySelector('[aria-label=\"Disable shortcut\"]').click()")
    await until(`document.querySelector('.settings-shortcuts').querySelectorAll('.settings-shortcut-key').length===${remaining}`)
  }
  assert.equal(await js("!!document.querySelector('.settings-shortcuts').querySelector('[aria-label=\"Disable shortcut\"]')"), false, 'dictation keeps its final binding')
  assert.equal((await stored()).shortcut.enabled, true)
  console.log('PASS conflict retry, reset, four-binding cap and the final dictation binding retain editor rules')

  await begin()
  await js("window.dispatchEvent(new Event('blur'));window.__emit({sessionId:window.__captureSequence,combination:'Control+Z',pressed:true});window.__emit({sessionId:window.__captureSequence,combination:'Control+Z',pressed:false})")
  await until("!document.querySelector('.is-recording')")
  assert.notEqual((await stored()).shortcut.accelerator, 'Control+Z', 'events queued behind blur must not save')
  console.log('PASS blur rejects an immediately following capture event')

  await begin()
  await js("document.querySelector('.is-recording').focus();document.querySelector('.settings-modal-close').focus();window.__emit({sessionId:window.__captureSequence,combination:'Control+Z',pressed:true});window.__emit({sessionId:window.__captureSequence,combination:'Control+Z',pressed:false})")
  await until("!document.querySelector('.is-recording')")
  assert.notEqual((await stored()).shortcut.accelerator, 'Control+Z', 'focus leaving the editor rejects late events synchronously')
  console.log('PASS focus leaving the editor immediately stops capture')

}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { win?.destroy(); app.exit(process.exitCode || 0) })
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
