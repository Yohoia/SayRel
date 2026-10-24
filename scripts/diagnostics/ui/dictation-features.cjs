const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, join } = require('node:path')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '../../..'), output = join(root, '.build/dictation-review')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-dictation-ui-'))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
let win
let failed = false
const failures = []
const js = expression => win.webContents.executeJavaScript(expression)
async function until(expression) {
  for (let index = 0; index < 120; index++) { if (await js(expression)) return; await new Promise(resolve => setTimeout(resolve, 40)) }
  throw new Error('UI timed out: ' + expression)
}
async function page(file, query = {}, hash = '') {
  await win.loadFile(join(root, '.build/ui-review', file + '.html'), { query, hash })
  await until("document.querySelector('#root')?.children.length > 0")
  await js('document.fonts.ready')
}
async function clickText(selector, text) {
  const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.trim() === ${JSON.stringify(text)})`
  await until(`!!(${expression})`)
  await js(`(() => { const node = ${expression}; node.scrollIntoView({block:'center'}); node.click() })()`)
}
async function select(label, text) {
  await js(`document.querySelector('.hub-select[aria-label="' + ${JSON.stringify(label)} + '"]').click()`)
  await clickText('.hub-select-menu button', text)
}
async function toggle(label) {
  const expression = `[...document.querySelectorAll('.settings-row')].find(row => row.querySelector('.settings-row-label')?.textContent === ${JSON.stringify(label)})?.querySelector('[role=switch]')`
  await until(`!!(${expression})`)
  await js(`${expression}.click()`)
}
async function personalization() {
  await until("!!document.querySelector('.home-settings')")
  await js("document.querySelector('.home-settings').click()")
  await clickText('.settings-nav-item', 'Personalization')
  await until("!!document.querySelector('.hub-select[aria-label=\"Cleanup level\"]')")
}
async function screenshot(name) {
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.equal(await js('document.documentElement.scrollWidth > innerWidth'), false, name + ' horizontal overflow')
  writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
}
app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
  win = new BrowserWindow({ width: 1080, height: 750, show: false, webPreferences: { backgroundThrottling: false } })
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) failures.push(message) })
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__dictationCalls = [];
    window.__dictationListeners = new Map();
    window.__dictationEmit = (channel, value) => { for (const listener of window.__dictationListeners.get(channel) || []) listener(value); };
    Object.defineProperty(window, 'sayrel', { configurable: true, get() { return this.__dictationBridge; }, set(value) {
      const invoke = value.invoke.bind(value), on = value.on.bind(value);
      value.invoke = (channel, ...args) => { window.__dictationCalls.push([channel, ...args]); return invoke(channel, ...args); };
      value.on = (channel, listener) => { const set = window.__dictationListeners.get(channel) || new Set(); set.add(listener); window.__dictationListeners.set(channel, set); const off = on(channel, listener); return () => { set.delete(listener); off(); }; };
      this.__dictationBridge = value;
    }});
  ` })
  await page('hub', { 'dictation-features': '1' }, '/dashboard')
  await js("window.sayrel.invoke('store:use','patch',{ language:'en', appearancePreference:'light' })")
  await personalization()
  assert.equal(await js("document.querySelector('.hub-select[aria-label=\"Cleanup level\"]').textContent.trim()"), 'Light cleanup')
  await select('Cleanup level', 'Original wording')
  await select('Writing style', 'formal')
  assert.equal((await js("window.sayrel.invoke('store:use','get')")).polishLevel, 'raw')
  await toggle('Automatic language detection')
  await until("!!document.querySelector('.hub-select[aria-label=\"Recognition language\"]')")
  await select('Recognition language', '中文')
  await toggle('Learn words from edits'); await toggle('Desktop commands')
  await until("document.body.innerText.includes('Desktop command shortcut')")
  const preferences = await js("window.sayrel.invoke('store:use','get')")
  assert.equal(preferences.dictionaryLearning, true); assert.equal(preferences.desktopCommandsEnabled, true)
  assert.equal(preferences.transcriptionLanguage, 'zh'); assert.equal(preferences.writingStyle, 'formal')
  await js("document.querySelector('.settings-content').scrollTo({top:0})")
  await screenshot('personalization-en')
  await page('hub', { 'dictation-features': '1' }, '/dashboard')
  await personalization()
  assert.equal(await js("document.querySelector('.hub-select[aria-label=\"Cleanup level\"]').textContent.trim()"), 'Original wording')
  await select('Cleanup level', 'Deep cleanup')
  await js("window.sayrel.invoke('store:use','patch',{language:'zh-CN',appearancePreference:'dark'})")
  await until("!!document.querySelector('.hub-select[aria-label=\"润写强度\"]')")
  await screenshot('personalization-zh-dark')
  console.log('PASS cleanup, style, language and opt-in controls save, reload and translate')

  await js("window.sayrel.invoke('store:use','patch',{language:'en',appearancePreference:'light'})")
  await page('hub', { 'dictation-features': '1' }, '/dictionary')
  await until("!!document.querySelector('.dictionary-suggestions')")
  await screenshot('dictionary-suggestion')
  await clickText('.dictionary-suggestions button', 'Add word')
  await until("!document.querySelector('.dictionary-suggestions') && [...document.querySelectorAll('.dictionary-word-name')].some(node => node.textContent === 'Sayrel Team')")
  await clickText('p[role=status] button', 'Undo')
  await until("![...document.querySelectorAll('.dictionary-word-name')].some(node => node.textContent === 'Sayrel Team')")
  console.log('PASS dictionary suggestions require confirmation and undo removes the accepted word')

  win.setSize(620, 600)
  await page('interactive-card', { 'desktop-command': '1' })
  await until("!!document.querySelector('.secondary-card-shell .desktop-command-confirmation')")
  assert.equal(await js("window.__dictationCalls.filter(item => item[0] === 'desktop-command:approve').length"), 0)
  await screenshot('desktop-confirmation')
  await clickText('.secondary-card-shell .desktop-command-confirmation button', 'Confirm action')
  await until("!document.querySelector('.desktop-command-confirmation') && document.body.innerText.includes('Opened Safari (offline fixture)')")
  assert.equal(await js("window.__dictationCalls.filter(item => item[0] === 'desktop-command:approve').length"), 1)
  console.log('PASS desktop confirmation renders and executes only after the explicit click')

  await page('floating-bar')
  const state = { phase: 'recording', context: { sessionId: 'live-one', mode: 'voice_transcript', handsFree: true, recorderTimeoutState: null } }
  await js(`window.__dictationEmit('recording-machine:state', ${JSON.stringify(state)})`)
  await js("window.__dictationEmit('recording-machine:partial', {sessionId:'old-session',text:'stale partial'})")
  assert.equal(await js("!!document.querySelector('.floating-partial')"), false)
  await js("window.__dictationEmit('recording-machine:partial', {sessionId:'live-one',text:'Live words while recording'})")
  await until("document.querySelector('.floating-partial')?.textContent === 'Live words while recording'")
  await screenshot('live-partial')
  await js(`window.__dictationEmit('recording-machine:state', ${JSON.stringify({ ...state, phase: 'finishing' })})`)
  await until("!document.querySelector('.floating-partial')")
  console.log('PASS live preview ignores stale sessions and clears when capture ends')
  assert.deepEqual(failures, [])
  console.log('PASS Dictation feature UI; screenshots: ' + output)
}).catch(error => { console.error(error); failed = true }).finally(() => {
  win?.destroy(); rmSync(profile, { recursive: true, force: true }); app.exit(failed ? 1 : 0)
})
