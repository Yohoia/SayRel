const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const assert = require('node:assert/strict')

const root = resolve(__dirname, '../..')
const output = join(root, 'docs/ui-evidence/settings-effects')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-settings-effects-'))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
let win, peer
const js = async (expression, target = win) => {
  try { return await target.webContents.executeJavaScript(expression) }
  catch (error) { throw new Error('Renderer check failed: ' + expression, { cause: error }) }
}
async function until(expression, target = win) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await js(expression, target)) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error('Timed out: ' + expression)
}

async function openSettings(query = {}, target = win) {
  await target.loadFile(join(root, '.build/ui-review/hub.html'), { query })
  await until("!!document.querySelector('.home-settings')", target)
  await js("document.querySelector('.home-settings').click()", target)
  await until("!!document.querySelector('.hub-select[aria-label=\"Interface language\"]')", target)
  await js('window.__settingsCalls = []', target)
}

async function select(label, text) {
  await js(`document.querySelector('.hub-select[aria-label="' + ${JSON.stringify(label)} + '"]').scrollIntoView({ block: 'center' })`)
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await js(`document.querySelector('.hub-select[aria-label="' + ${JSON.stringify(label)} + '"]').click()`)
  await until("!!document.querySelector('.hub-select-menu')")
  await js(`[...document.querySelectorAll('.hub-select-menu button')].find(button => button.textContent === ${JSON.stringify(text)}).click()`)
}

async function clearToasts() {
  await js("document.querySelectorAll('.sayrel-toast').forEach(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))")
  await until("!document.querySelector('.sayrel-toast')")
}

async function createWindow() {
  const target = new BrowserWindow({ width: 1080, height: 750, show: false, webPreferences: { backgroundThrottling: false } })
  await target.loadURL('about:blank')
  target.webContents.debugger.attach('1.3')
  await target.webContents.debugger.sendCommand('Page.enable')
  await target.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (location.protocol === 'file:') localStorage.setItem('sayrel-ui-settings', JSON.stringify({ language: 'en', appearancePreference: 'light' }));
    window.__settingsCalls = [];
    window.__settingsMessages = [];
    window.__settingsListeners = new Map();
    window.__settingsFaults = { save: false, appearance: false, holdGet: false, holdPatch: false };
    window.__settingsFaults.holdGet = new URLSearchParams(location.search).has('hold-settings-get');
    window.__settingsEmit = (channel, value) => {
      for (const listener of window.__settingsListeners.get(channel) || []) listener(value);
    };
    Object.defineProperty(window, 'sayrel', { configurable: true, get() { return this.__settingsBridge }, set(value) {
      const invoke = value.invoke.bind(value), on = value.on.bind(value);
      for (const channel of ['store:changed', 'i18n:language-changed', 'appearance:color-mode-changed']) {
        on(channel, snapshot => window.__settingsMessages.push([channel, structuredClone(snapshot)]));
      }
      value.on = (channel, listener) => {
        const listeners = window.__settingsListeners.get(channel) || new Set();
        listeners.add(listener); window.__settingsListeners.set(channel, listeners);
        const off = on(channel, (...args) => {
          if (channel === 'appearance:color-mode-changed' && window.__settingsSuppressAppearance) return;
          listener(...args);
        });
        return () => { listeners.delete(listener); off(); };
      };
      value.invoke = async (channel, ...args) => {
        window.__settingsCalls.push([channel, ...args]);
        const patch = channel === 'store:use' && args[0] === 'patch';
        if (patch && window.__settingsFaults.save) {
          window.__settingsFaults.save = false;
          throw new Error('fixture disk write rejected');
        }
        const failAppearance = patch && window.__settingsFaults.appearance;
        if (failAppearance) {
          window.__settingsFaults.appearance = false;
          window.__settingsSuppressAppearance = true;
        }
        const result = await invoke(channel, ...args);
        if (failAppearance) {
          window.__settingsSuppressAppearance = false;
          throw new Error('Settings saved, but appearance could not be applied. Please try again.');
        }
        const holdGet = channel === 'store:use' && args[0] === 'get' && window.__settingsFaults.holdGet;
        if (holdGet || patch && window.__settingsFaults.holdPatch) {
          const snapshot = structuredClone(result);
          if (holdGet) window.__settingsFaults.holdGet = false;
          else window.__settingsFaults.holdPatch = false;
          return new Promise(resolve => {
            window[holdGet ? '__releaseSettingsGet' : '__releaseSettingsPatch'] = () => resolve(snapshot);
          });
        }
        return result;
      };
      this.__settingsBridge = value;
    }});
  ` })
  return target
}

app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }))
  win = await createWindow()
  await openSettings()
  await select('Interface language', new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of('zh-CN'))
  await until("document.documentElement.lang === 'zh-CN' && !!document.querySelector('.sayrel-toast.is-success')")
  assert.deepEqual(await js("window.__settingsCalls.filter(call => call[0] === 'store:use' && call[1] === 'patch' || call[0] === 'i18n:set-language')"), [['store:use', 'patch', { language: 'zh-CN' }]], 'language selection saves through one settings entry')
  console.log('PASS language selection saves through one settings entry')

  await openSettings()
  await select('Appearance', 'Dark')
  await until("document.documentElement.dataset.colorMode === 'dark' && !!document.querySelector('.sayrel-toast.is-success')")
  assert.deepEqual(await js("window.__settingsCalls.filter(call => call[0] === 'store:use' && call[1] === 'patch' || call[0] === 'appearance:set-preference')"), [['store:use', 'patch', { appearancePreference: 'dark' }]], 'appearance selection saves through one settings entry')
  console.log('PASS appearance selection saves and applies through one settings entry')

  await openSettings()
  await js('window.__settingsFaults.save = true')
  await select('Interface language', new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of('zh-CN'))
  await until("document.querySelector('.sayrel-toast.is-error .toast-message')?.textContent === 'Could not save. Please try again.'")
  assert.equal(await js("document.documentElement.lang"), 'en', 'failed save leaves the chosen language unchanged')
  assert.equal(await js("document.querySelectorAll('.sayrel-toast.is-success').length"), 0, 'failed save never displays a success toast')
  assert.equal(await js("document.querySelectorAll('.sayrel-toast.is-error').length"), 1, 'failed save displays one error toast')
  console.log('PASS save rejection preserves visible settings and reports only failure')

  await openSettings()
  await js('window.__settingsFaults.appearance = true')
  await select('Appearance', 'Dark')
  await until("document.querySelector('.sayrel-toast.is-error .toast-message')?.textContent === 'Settings saved, but appearance could not be applied. Please try again.'")
  assert.equal(await js("document.querySelector('.hub-select[aria-label=Appearance]').textContent"), 'Dark', 'saved preference reaches the UI after an apply failure')
  assert.equal(await js("document.documentElement.dataset.colorMode"), 'light', 'failed appearance effect does not claim the theme changed')
  assert.equal(await js("document.querySelectorAll('.sayrel-toast.is-success').length"), 0, 'apply failure never displays success')
  assert.equal(await js("document.querySelectorAll('.sayrel-toast.is-error').length"), 1, 'apply failure reports the unfinished action once')
  await js('document.fonts.ready')
  await until("!document.querySelector('.hub-select-menu')")
  await js('Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => null)))')
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync(join(output, 'saved-appearance-failure.png'), (await win.webContents.capturePage()).toPNG())
  await clearToasts()
  await select('Appearance', 'Dark')
  await until("document.documentElement.dataset.colorMode === 'dark' && !!document.querySelector('.sayrel-toast.is-success')")
  assert.equal(await js("document.querySelectorAll('.sayrel-toast.is-error').length"), 0, 'retry clears the failed operation')
  assert.equal(await js("window.__settingsCalls.filter(call => call[0] === 'store:use' && call[1] === 'patch').length"), 2, 'retrying the saved target uses one additional settings operation')
  console.log('PASS saved preference survives an apply failure and the same selection can be retried')

  await openSettings({ 'hold-settings-get': 'true' })
  await until("typeof window.__releaseSettingsGet === 'function'")
  await js("window.sayrel.invoke('store:use', 'patch', { language: 'zh-CN' })")
  await until("document.documentElement.lang === 'zh-CN'")
  await js("window.__releaseSettingsGet(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
  assert.equal(await js('document.documentElement.lang'), 'zh-CN', 'late initial get does not overwrite a newer settings broadcast')
  assert.equal(await js("document.querySelector('.home-navigation a').textContent"), '首页', 'late initial get leaves navigation in the current language')
  console.log('PASS newer settings broadcasts survive a late initial settings response')

  await openSettings()
  await js('window.__settingsFaults.holdPatch = true')
  await select('Appearance', 'Dark')
  await until("typeof window.__releaseSettingsPatch === 'function' && document.querySelector('.hub-select[aria-label=Appearance]')?.textContent === 'Dark'")
  await js("window.sayrel.invoke('store:use', 'patch', { appearancePreference: 'light' })")
  await until("document.querySelector('.hub-select[aria-label=Appearance]')?.textContent === 'Light'")
  await js("window.__releaseSettingsPatch(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
  assert.equal(await js("document.querySelector('.hub-select[aria-label=Appearance]').textContent"), 'Light', 'late patch response does not overwrite a newer settings broadcast')
  assert.equal(await js('document.documentElement.dataset.colorMode'), 'light', 'theme remains synchronized with the latest setting')
  console.log('PASS newer settings broadcasts survive a late settings patch response')

  await openSettings()
  peer = await createWindow()
  await openSettings({}, peer)
  await select('Appearance', 'Dark')
  await until("document.documentElement.dataset.colorMode === 'dark'")
  await select('Interface language', new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of('zh-CN'))
  await until("document.documentElement.lang === 'zh-CN'")
  const messages = await js('window.__settingsMessages')
  for (const channel of ['store:changed', 'i18n:language-changed', 'appearance:color-mode-changed']) {
    assert.ok(messages.some(message => message[0] === channel), 'settings operation publishes ' + channel)
  }
  // Relay the fixture's emitted IPC messages to another real renderer window.
  await js(`for (const [channel, snapshot] of ${JSON.stringify(messages)}) window.__settingsEmit(channel, snapshot)`, peer)
  await until("document.documentElement.lang === 'zh-CN' && document.documentElement.dataset.colorMode === 'dark'", peer)
  assert.equal(await js("document.querySelector('.home-navigation a').textContent", peer), '首页', 'the second window receives the selected language')
  assert.equal(await js("[...document.querySelectorAll('.hub-select')].find(control => control.getAttribute('aria-label') === '外观')?.textContent", peer), '黑暗', 'the second settings window receives the saved appearance')
  console.log('PASS two open settings windows converge on language and appearance broadcast snapshots')
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  peer?.destroy()
  win?.destroy()
  app.exit(process.exitCode || 0)
})
app.on('quit', () => {
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  catch (error) { console.warn('Could not remove temporary settings test profile:', error.message) }
})
