// Offline UI behavior; real recording/history behavior is covered by voice-recovery.cjs.
const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, join } = require('node:path')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '../../..')
const output = join(root, '.build/refinement-review')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-refinement-review-'))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
let win
const js = expression => win.webContents.executeJavaScript(expression)
async function until(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await js(expression)) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error('UI timed out: ' + expression)
}
async function click(text) {
  await js(`(() => {const button=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(text)}); if(!button) throw new Error('Missing button: '+${JSON.stringify(text)}); button.click()})()`)
}
async function page(fail = '') {
  await win.loadFile(join(root, '.build/ui-review/hub.html'), { hash: '/history', query: { 'refinement-review': '1', fail } })
  await until("document.querySelectorAll('.history-item').length === 3")
}
async function screenshot(name) {
  await js('document.fonts.ready')
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await js('document.documentElement.scrollWidth > innerWidth'), false)
  writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
}
app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
  win = new BrowserWindow({ width: 1080, height: 850, show: false, webPreferences: { backgroundThrottling: false } })
  await page()
  await js("window.sayrel.invoke('store:use','patch',{language:'en',polishLevel:'strong',writingStyle:'concise'})")
  await until("document.body.innerText.includes('Refinement completed without changes')")
  assert.equal(await js("document.body.innerText.includes('Not refined: no writing model selected')"), true)
  await click('View details')
  await until("!!document.querySelector('[role=dialog]')")
  assert.equal(await js("document.querySelector('.history-text-comparison').innerText.includes('Um, tomorrow at five. No, make that six.')"), true)
  await screenshot('before')
  await click('Refine again with current settings')
  await until("document.querySelector('[role=dialog]')?.innerText.includes('Tomorrow at six.') && document.querySelector('[role=dialog]')?.innerText.includes('Deep cleanup')")
  assert.equal(await js("document.querySelector('.history-text-comparison section:first-child').innerText.includes('Um, tomorrow at five.')"), true)
  assert.equal(await js("document.querySelector('[role=dialog]').innerText.includes('fixture-writing-model')"), true)
  await screenshot('after')
  await js("window.sayrel.invoke('store:use','patch',{language:'zh-CN'})")
  await until("document.querySelector('[role=dialog]')?.innerText.includes('按当前设置重新整理')")
  assert.equal(await js("document.querySelector('[role=dialog]').innerText.includes('深整理')"), true)
  await screenshot('chinese')
  await page('refinement')
  await js("window.sayrel.invoke('store:use','patch',{language:'en'})")
  await click('View details')
  const before = await js("document.querySelector('.history-text-comparison').innerText")
  await click('Refine again with current settings')
  await until("document.body.innerText.includes('Previous result kept.')")
  assert.equal(await js("document.querySelector('.history-text-comparison').innerText"), before)
  await win.loadFile(join(root, '.build/ui-review/interactive-card.html'), { query: { 'insertion-review': '1' } })
  await until("document.querySelector('.secondary-card-shell')?.style.opacity === '1'")
  assert.equal(await js("document.querySelector('.secondary-card-shell .secondary-insertion-warning').innerText.includes('Check the target before copying')"), true)
  assert.equal(await js("document.querySelector('.secondary-card-shell .secondary-answer-content').innerText"), 'Writing preserved for manual review.')
  await screenshot('insertion-unknown')
  console.log('PASS refinement UI: skipped/unchanged states, original comparison, current-settings rewrite without audio, refreshed metadata, Chinese labels, failed rewrite preserves output, visible unverified-insertion warning')
}).then(() => { win?.destroy(); app.exit(0) }).catch(error => { console.error(error); win?.destroy(); app.exit(1) })
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
