// Run with Electron. Isolated fixture build, temporary profile, no server/real IPC.
const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-ui-review-'))
const root = resolve(__dirname, '../..')
const output = join(root, 'docs/ui-evidence/continuation')
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
let win
const reports = [], errors = []
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
    if (await win.webContents.executeJavaScript(expression)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`UI timed out: ${expression}`)
}
async function page(file, query = {}, hash = '') {
  await win.loadFile(join(root, '.build/ui-review', file), { query, hash })
  await waitFor("document.querySelector('#root')?.children.length > 0")
  await win.webContents.executeJavaScript('document.fonts.ready')
  await win.webContents.executeJavaScript("Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => null))).then(() => true)")
  await new Promise(resolve => setTimeout(resolve, 350))
}
async function shot(name) {
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await win.webContents.executeJavaScript("Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => null))).then(() => true)")
  const png = await win.webContents.capturePage()
  assert.ok(!png.isEmpty(), name)
  writeFileSync(join(output, `${name}.png`), png.toPNG())
  const report = await win.webContents.executeJavaScript(`({ text: document.body.innerText.slice(0, 1600), overflow: document.documentElement.scrollWidth > innerWidth, missingImages: [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.src) })`)
  assert.equal(report.overflow, false, name + ' overflows')
  assert.deepEqual(report.missingImages, [], name + ' missing images')
  const visibleScrollbars = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('*')).filter(node => {
    const style = getComputedStyle(node);
    return /(auto|scroll)/.test(style.overflowX + style.overflowY) && (style.scrollbarWidth !== 'none' || getComputedStyle(node, '::-webkit-scrollbar').display !== 'none');
  }).map(node => node.className || node.tagName)`)
  assert.deepEqual(visibleScrollbars, [], name + ' visible scrollbars')
  reports.push({ name, ...report })
  console.log('PASS ' + name)
}
app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true })
  // Block all external requests; these are visual fixtures, not live service tests.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
  win = new BrowserWindow({ width: 1080, height: 750, show: false, webPreferences: { backgroundThrottling: false } })
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message) })
  for (const name of ['dashboard', 'history', 'dictionary']) {
    await page('hub.html', {}, '/' + name)
    await waitFor("!!document.querySelector('.page-title')")
    await shot(name)
  }
  await win.webContents.executeJavaScript("window.sayrel.invoke('page:open-settings-modal', 'shortcuts')")
  await waitFor("!!document.querySelector('[role=dialog]')")
  await shot('shortcuts')
  const clickText = async (selector, label) => {
    await win.webContents.executeJavaScript(`(() => { const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.textContent.trim() === ${JSON.stringify(label)}); if (!target) throw new Error('Missing control: ' + ${JSON.stringify(label)}); target.scrollIntoView({ block: 'center' }); target.click() })()`)
  }
  const closeDialog = async () => {
    await win.webContents.executeJavaScript("document.querySelector('.settings-subdialog .modal-close').click()")
    await waitFor("!document.querySelector('.settings-subdialog')")
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.settings-modal')"), true)
  }
  assert.equal(await win.webContents.executeJavaScript("[...document.querySelectorAll('.settings-group-title')].map(node => node.innerText).join(',')"), "System permissions,Shortcuts,Language,Audio,General")
  assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('Sayrel 本地配置')"), false)
  await clickText('.settings-content button', "Select language variants")
  await waitFor("document.querySelectorAll('.settings-variant').length === 5")
  await shot('settings-language-variants')
  await win.webContents.executeJavaScript("document.querySelector('.settings-variant .hub-select').click()")
  await waitFor("!!document.querySelector('[role=listbox]')")
  const britishEnglish = await win.webContents.executeJavaScript("new Intl.DisplayNames(['en'],{type:'language'}).of('en-GB')")
  await clickText('[role=option]', britishEnglish)
  await waitFor("document.querySelector('.settings-variant .hub-select').innerText.includes(" + JSON.stringify(britishEnglish) + ")")
  await closeDialog()
  assert.ok((await win.webContents.executeJavaScript("window.sayrel.invoke('store:use','get')")).preferredLanguages.includes('en-GB'))
  await win.webContents.executeJavaScript("document.querySelector('.settings-picker').click()")
  await waitFor("!!document.querySelector('.settings-language-list')")
  await clickText('.settings-subdialog button', "Add another language")
  await waitFor("!!document.querySelector('.settings-language-search')")
  await clickText('.settings-language-search [role=option]', "Japanese")
  await waitFor("document.querySelectorAll('.settings-language-item').length === 2")
  await shot('settings-translation-targets')
  await closeDialog()
  await win.webContents.executeJavaScript("document.querySelectorAll('.settings-picker')[1].click()")
  await waitFor("document.querySelectorAll('.settings-mic-option').length === 3")
  await shot('settings-microphone')
  await win.webContents.executeJavaScript("document.querySelectorAll('.settings-mic-option')[2].click()")
  await waitFor("document.querySelectorAll('.settings-mic-option')[2].getAttribute('aria-checked') === 'true'")
  await closeDialog()
  assert.equal((await win.webContents.executeJavaScript("window.sayrel.invoke('store:use','get')")).micDevice, 'fixture-usb')
  await win.webContents.executeJavaScript("document.querySelector('.settings-shortcuts .settings-add').click()")
  await waitFor("!!document.querySelector('.is-recording')")
  await win.webContents.executeJavaScript("(() => { const button = document.querySelector('.is-recording'); button.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); button.dispatchEvent(new KeyboardEvent('keyup', { key: 'k', ctrlKey: true, bubbles: true })) })()")
  await waitFor("document.querySelectorAll('.settings-shortcuts')[0].querySelectorAll('.settings-shortcut-key').length === 2 && !document.querySelector('.is-recording')")
  await shot('settings-multiple-shortcuts')
  for (const title of ["Personalization", "About", "Help"]) {
    await clickText('.settings-nav-item', title)
    await shot('settings-' + title)
  }
  await clickText('.settings-content button', "Start")
  await waitFor("!!document.querySelector('.tour-feature-cards')")
  await shot('settings-feature-tour'); await closeDialog()
  await clickText('.settings-nav-item', "Settings")
  await win.webContents.executeJavaScript("document.querySelector('button[aria-label=\"Interface language\"]').click()")
  await waitFor("!!document.querySelector('[role=listbox]')")
  const chinese = await win.webContents.executeJavaScript("new Intl.DisplayNames(['zh-CN'], {type:'language'}).of('zh-CN')")
  await clickText('[role=option]', chinese)
  await waitFor("document.querySelector('.settings-title')?.innerText === '设置'")
  await shot('settings-chinese')
  await win.webContents.executeJavaScript("window.sayrel.invoke('store:use', 'patch', { language: 'en' })")
  await waitFor("document.querySelector('.settings-title')?.innerText === 'Settings'")
  await shot('settings-english')
  win.setSize(840, 560)
  await shot('settings-small-window')
  for (const state of ['hover', 'starting-microphone', 'hands-free', 'error', 'long-pressing']) {
    win.setSize(750, 500)
    await page('floating-bar.html', { state, mode: 'translation', ...(state === 'hands-free' ? { countdown: '00:25' } : {}) })
    await waitFor(`document.querySelector('[data-testid="floating-bar"]')?.dataset.status === ${JSON.stringify(state)}`)
    await shot('floating-' + state)
  }
  win.setSize(800, 500)
  await page('interactive-card.html'); await shot('answer-card')
  writeFileSync(join(output, 'report.json'), JSON.stringify({ reports, errors, scope: 'Offline fixtures; no real microphone, keys, providers or user data' }, null, 2))
  assert.deepEqual(errors, [])
}).catch(error => { console.error(error); console.error(errors.join('\n')); process.exitCode = 1 }).finally(() => {
  win?.destroy(); app.exit(process.exitCode || 0)
})
app.on('quit', () => { rmSync(profile, { recursive: true, force: true }) })
