// Isolated brand verification: local assets and UI only, with network requests blocked.
const { app, BrowserWindow, session, nativeImage } = require('electron')
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')

const root = resolve(__dirname, '../..')
const output = join(root, 'docs/ui-evidence/branding')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-brand-'))
const reports = [], errors = []
let win
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')

const js = expression => win.webContents.executeJavaScript(expression)
async function until(expression) {
  for (let i = 0; i < 100; i++) {
    if (await js(expression)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Timed out: ' + expression)
}
async function shot(name, bodySelector) {
  await js('document.fonts.ready')
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await js('Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => null))).then(() => true)')
  const report = await js(`({ name:${JSON.stringify(name)}, lang:document.documentElement.lang, text:document.body.innerText,
    missing:[...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.src),
    overflow:document.documentElement.scrollWidth > innerWidth,
    bodyFont:getComputedStyle(document.querySelector(${JSON.stringify(bodySelector)})).fontFamily })`)
  assert.deepEqual(report.missing, [], name + ' images load')
  assert.equal(report.overflow, false, name + ' fits the window')
  assert.equal(report.lang, 'en')
  assert.equal(/\p{Script=Han}/u.test(report.text), false, name + ' uses English')
  assert.ok(report.bodyFont.startsWith('Inter'), name + ' body uses Inter')
  writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
  reports.push(report)
  console.log('PASS ' + name)
}
function verifyAsset(path, expected) {
  const bytes = readFileSync(join(root, path))
  assert.equal(bytes.length, expected.bytes, path + ' size')
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, path + ' checksum')
}

app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true })
  session.defaultSession.webRequest.onBeforeRequest({ urls:['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel:true }))
  const assets = JSON.parse(readFileSync(join(root, 'public/assets/brand/manifest.json'), 'utf8')).assets
  for (const asset of assets) verifyAsset(asset.path, asset)
  const fonts = JSON.parse(readFileSync(join(root, 'public/fonts/hermes/sources.json'), 'utf8'))
  for (const font of fonts) verifyAsset('public/fonts/hermes/' + font.file, font)
  console.log(`PASS ${assets.length} brand files and ${fonts.length} font/source files match their manifests`)
  const icon = nativeImage.createFromPath(join(root, 'resources/build/icon.png'))
  assert.deepEqual(icon.getSize(), { width:1024, height:1024 })
  const dockIcon = nativeImage.createFromPath(join(root, 'resources/build/mac-icon.png'))
  assert.deepEqual(dockIcon.getSize(), { width:1024, height:1024 })
  const pixels = dockIcon.toBitmap()
  let left = 1024, top = 1024, right = -1, bottom = -1
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    if (pixels[(y * 1024 + x) * 4 + 3] > 128) {
      left = Math.min(left, x); top = Math.min(top, y)
      right = Math.max(right, x); bottom = Math.max(bottom, y)
    }
  }
  assert.deepEqual({ left, top, right, bottom }, { left:100, top:100, right:923, bottom:923 }, 'macOS artwork matches the Typeless inset')
  console.log('PASS macOS Dock artwork: 824px centered on a 1024px transparent canvas')
  const tray = nativeImage.createFromPath(join(root, 'resources/build/tray.png'))
  assert.deepEqual(tray.getSize(), { width:16, height:16 })
  assert.deepEqual(tray.getScaleFactors(), [1, 2])
  if (process.platform === 'darwin') {
    tray.setTemplateImage(true)
    assert.equal(tray.isTemplateImage(), true)
  }
  console.log('PASS app icon and 16px / 32px tray representations')
  win = new BrowserWindow({ width:1080, height:750, useContentSize:true, show:false, webPreferences:{ backgroundThrottling:false } })
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message) })
  await win.loadFile(join(root, '.build/ui-review/hub.html'))
  await until("!!document.querySelector('.home-headline')")
  const fontStatus = await js(`Promise.all(['Inter', 'Rules Variable', 'Rules Gothic Condensed', 'Rules Gothic Compressed', 'JetBrains Mono'].map(async family => ({ family, count:(await document.fonts.load('400 24px "' + family + '"', 'Sayrel')).length })))`)
  assert.ok(fontStatus.every(font => font.count > 0), 'all five local font families load offline')
  await win.loadFile(join(root, '.build/ui-review/onboarding.html'))
  await until("document.querySelector('.secondary-onboarding-copy h1')?.innerText.includes('privacy')")
  await shot('onboarding-permissions', '.secondary-onboarding-copy h1')
  await js("document.querySelector('.secondary-onboarding-footer .secondary-primary-button').click()")
  await until("!!document.querySelector('.secondary-volume-bars') && !document.querySelector('.secondary-onboarding-footer .secondary-primary-button').disabled")
  await shot('onboarding-microphone', '.secondary-onboarding-description')
  await js("document.querySelector('.secondary-onboarding-footer .secondary-primary-button').click()")
  await until("!!document.querySelector('.secondary-keyboard-panel')")
  await shot('onboarding-shortcut', '.secondary-onboarding-description')
  win.setContentSize(350, 500)
  await win.loadFile(join(root, '.build/ui-review/sidebar.html'))
  await until("!!document.querySelector('.secondary-sidebar')")
  await shot('context-sidebar', '.secondary-sidebar p')
  win.setContentSize(800, 500)
  await win.loadFile(join(root, '.build/ui-review/interactive-card.html'))
  await until("document.querySelector('.secondary-answer-content')?.innerText.includes('Clear writing')")
  await shot('answer-card', '.secondary-answer-content')
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'report.json'), JSON.stringify({ reports, errors, fonts:fontStatus, assets:assets.length, scope:'Offline fixtures; temporary profile; no real microphone or providers' }, null, 2))
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  win?.destroy()
  rmSync(profile, { recursive:true, force:true })
  app.exit(process.exitCode || 0)
})
