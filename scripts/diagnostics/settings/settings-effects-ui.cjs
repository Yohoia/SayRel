const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const assert = require('node:assert/strict')

const root = resolve(__dirname, '../../..')
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

async function toggleSetting({ label }) {
  const expression = `[...document.querySelectorAll('.settings-row')].find(row => row.querySelector('.settings-row-label')?.textContent === ${JSON.stringify(label)})?.querySelector('[role="switch"]')`
  await until(`!!(${expression})`)
  await js(`${expression}.scrollIntoView({ block: 'center' })`)
  await js(`${expression}.click()`)
}

async function readToggle({ label, target = win }) {
  return js(`[...document.querySelectorAll('.settings-row')].find(row => row.querySelector('.settings-row-label')?.textContent === ${JSON.stringify(label)})?.querySelector('[role="switch"]')?.getAttribute('aria-checked')`, target)
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
    window.__settingsUnhandled = [];
    window.addEventListener('unhandledrejection', event => window.__settingsUnhandled.push(String(event.reason)));
    window.__settingsListeners = new Map();
    window.__settingsFaults = { save: false, appearance: false, login: false, dock: false, shortcuts: false, holdGet: false, holdPatch: false };
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
        const failLogin = patch && 'launchAtLogin' in args[1] && window.__settingsFaults.login;
        const failDock = patch && 'showInDock' in args[1] && window.__settingsFaults.dock;
        const failShortcuts = patch && window.__settingsFaults.shortcuts && ['shortcut', 'translationShortcut', 'askAnythingShortcut', 'commandShortcut', 'additionalShortcuts'].some(key => key in args[1]);
        const result = await invoke(channel, ...args);
        if (failAppearance) {
          window.__settingsSuppressAppearance = false;
          throw new Error('Settings saved, but appearance could not be applied. Please try again.');
        }
        if (failLogin) {
          window.__settingsFaults.login = false;
          throw new Error('Settings saved, but launch at startup could not be applied. Please try again.');
        }
        if (failDock) {
          window.__settingsFaults.dock = false;
          throw new Error('Settings saved, but Dock visibility could not be applied. Please try again.');
        }
        if (failShortcuts) {
          window.__settingsFaults.shortcuts = false;
          throw new Error('Settings saved, but shortcuts could not be applied. Please try again.');
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
  await toggleSetting({ label: 'Launch at startup' })
  await until("!!document.querySelector('.sayrel-toast.is-success')")
  assert.deepEqual(await js("window.__settingsCalls.filter(call => call[0] === 'store:use' && call[1] === 'patch' || call[0] === 'permission:update-auto-launch')"), [['store:use', 'patch', { launchAtLogin: true }]], 'startup toggle saves through one settings entry')
  console.log('PASS startup toggle saves through one settings entry')

  await openSettings()
  await toggleSetting({ label: 'Show app in dock' })
  await until("!!document.querySelector('.sayrel-toast.is-success')")
  assert.deepEqual(await js("window.__settingsCalls.filter(call => call[0] === 'store:use' && call[1] === 'patch' || call[0] === 'permission:update-show-app-in-dock')"), [['store:use', 'patch', { showInDock: false }]], 'Dock toggle saves through one settings entry')
  console.log('PASS Dock toggle saves through one settings entry')

  await openSettings()
  await js('window.__settingsFaults.save = true')
  await toggleSetting({ label: 'Interaction sounds' })
  await until("document.querySelector('.sayrel-toast.is-error .toast-message')?.textContent === 'Could not save. Please try again.'")
  await js('new Promise(resolve => setTimeout(resolve, 100))')
  assert.deepEqual(await js('window.__settingsUnhandled'), [], 'handled save rejection must not escape as an unhandled promise')
  assert.equal(await readToggle({ label: 'Interaction sounds' }), 'true', 'failed sound setting remains unchanged')
  console.log('PASS audio save rejection is handled and preserves the visible setting')

  await openSettings()
  await js('window.__settingsFaults.shortcuts = true')
  await js("[...document.querySelectorAll('.settings-row')].find(row => row.querySelector('.settings-row-label')?.textContent === 'Translate').querySelector('[aria-label=\"Disable shortcut\"]').click()")
  await until("document.querySelector('.sayrel-toast.is-error .toast-message')?.textContent === 'Settings saved, but shortcuts could not be applied. Please try again.'")
  assert.equal(await js("window.sayrel.invoke('store:use', 'get').then(settings => settings.translationShortcut.enabled)"), false, 'shortcut disable remains saved after a registration failure')
  assert.equal(await js("[...document.querySelectorAll('.settings-row')].find(row => row.querySelector('.settings-row-label')?.textContent === 'Translate').querySelectorAll('.settings-shortcut-key').length"), 0, 'shortcut editor displays the actual saved disabled state')
  assert.equal(await js("document.querySelectorAll('.sayrel-toast.is-success').length"), 0, 'registration failure never displays success')
  await js('new Promise(resolve => setTimeout(resolve, 100))')
  assert.deepEqual(await js('window.__settingsUnhandled'), [], 'shortcut disable handles the saved-but-not-applied rejection')
  console.log('PASS shortcut disable retains saved state and reports registration failure without an unhandled rejection')

  await openSettings()
  await js("[...document.querySelectorAll('.settings-row')].find(row => row.querySelector('.settings-row-label')?.textContent === 'Translation targets').querySelector('.settings-picker').click()")
  await until("!!document.querySelector('.settings-subdialog')")
  await js("document.querySelector('.settings-subdialog .settings-add').click()")
  await until("!!document.querySelector('[role=listbox]')")
  await js('window.__settingsFaults.save = true')
  await js("[...document.querySelectorAll('[role=option]')].find(option => option.textContent === 'Japanese').click()")
  await until("document.querySelector('.sayrel-toast.is-error .toast-message')?.textContent === 'Could not save. Please try again.'")
  assert.deepEqual(await js("window.sayrel.invoke('store:use', 'get').then(settings => settings.translationTargetLanguages)"), ['en'], 'failed translation target save preserves the current target')
  assert.equal(await js("document.querySelectorAll('.settings-language-item').length"), 1, 'failed translation target save does not add an unsaved target')
  await js('new Promise(resolve => setTimeout(resolve, 100))')
  assert.deepEqual(await js('window.__settingsUnhandled'), [], 'translation target selection handles save rejection')
  await clearToasts()
  await js("[...document.querySelectorAll('[role=option]')].find(option => option.textContent === 'Japanese').click()")
  await until("!!document.querySelector('.sayrel-toast.is-success') && !document.querySelector('[role=listbox]')")
  assert.deepEqual(await js("window.sayrel.invoke('store:use', 'get').then(settings => settings.translationTargetLanguages)"), ['en', 'ja'], 'retry adds the same chosen translation target')
  console.log('PASS translation target save failure preserves state and allows retry without an unhandled rejection')

  for (const { label, key, initial, next } of [
    { label: 'Launch at startup', key: 'launchAtLogin', initial: false, next: true },
    { label: 'Show app in dock', key: 'showInDock', initial: true, next: false },
    { label: 'Show live transcript', key: 'showLiveTranscript', initial: true, next: false }
  ]) {
    await openSettings()
    await js('window.__settingsFaults.save = true')
    await toggleSetting({ label })
    await until("document.querySelector('.sayrel-toast.is-error .toast-message')?.textContent === 'Could not save. Please try again.'")
    assert.equal(await readToggle({ label }), String(initial), 'failed save preserves ' + label)
    assert.equal(await js("document.querySelectorAll('.sayrel-toast.is-success').length"), 0, 'failed save never displays success')
    await clearToasts()
    await toggleSetting({ label })
    await until("!!document.querySelector('.sayrel-toast.is-success')")
    assert.equal(await readToggle({ label }), String(next), 'the same requested target can be saved after retry')
    assert.deepEqual(await js("window.__settingsCalls.filter(call => call[0] === 'store:use' && call[1] === 'patch')"), [['store:use', 'patch', { [key]: next }], ['store:use', 'patch', { [key]: next }]], 'retry sends the same requested target once more')
    assert.deepEqual(await js('window.__settingsUnhandled'), [], 'save rejection is handled by the UI')
    console.log('PASS ' + label + ' save failure preserves state and allows the same target retry')
  }

  for (const { label, key, next, fault, message } of [
    { label: 'Launch at startup', key: 'launchAtLogin', next: true, fault: 'login', message: 'Settings saved, but launch at startup could not be applied. Please try again.' },
    { label: 'Show app in dock', key: 'showInDock', next: false, fault: 'dock', message: 'Settings saved, but Dock visibility could not be applied. Please try again.' }
  ]) {
    await openSettings()
    await js(`window.__settingsFaults[${JSON.stringify(fault)}] = true`)
    await toggleSetting({ label })
    await until(`document.querySelector('.sayrel-toast.is-error .toast-message')?.textContent === ${JSON.stringify(message)}`)
    assert.equal(await readToggle({ label }), String(next), 'the UI receives the actual saved target despite an effect failure')
    assert.equal(await js(`window.sayrel.invoke('store:use', 'get').then(settings => settings[${JSON.stringify(key)}])`), next, 'the settings interface exposes the saved target')
    assert.equal(await js("document.querySelectorAll('.sayrel-toast.is-success').length"), 0, 'effect failure never displays success')
    assert.equal(await js("document.querySelectorAll('.sayrel-toast.is-error').length"), 1, 'effect failure displays one explicit error')
    await js('new Promise(resolve => setTimeout(resolve, 100))')
    assert.deepEqual(await js('window.__settingsUnhandled'), [], 'effect rejection is handled by the UI')
    console.log('PASS ' + label + ' effect failure reports partial completion and retains the saved target')
  }

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
  await toggleSetting({ label: 'Launch at startup' })
  await toggleSetting({ label: 'Show app in dock' })
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
  assert.equal(await readToggle({ label: '登录时启动应用', target: peer }), 'true', 'the second settings window receives the saved startup preference')
  assert.equal(await readToggle({ label: '在Dock中显示应用', target: peer }), 'false', 'the second settings window receives the saved Dock preference')
  console.log('PASS two open settings windows converge on language, appearance, startup, and Dock broadcast snapshots')
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  peer?.destroy()
  win?.destroy()
  app.exit(process.exitCode || 0)
})
app.on('quit', () => {
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  catch (error) { console.warn('Could not remove temporary settings test profile:', error.message) }
})
