const { app, BrowserWindow, session } = require('electron')
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'offkey-retention-ui-'))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
let win
const js = expression => win.webContents.executeJavaScript(expression)
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
    if (await js(expression)) return
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  throw new Error('UI timeout: ' + expression)
}
async function choose(value) {
  await waitFor("!document.querySelector('[role=alertdialog]') && document.querySelector('.history-retention .hub-select')?.disabled === false")
  await js("document.querySelector('.history-retention .hub-select').click()")
  await waitFor("!!document.querySelector('[role=listbox]')")
  await js(`[...document.querySelectorAll('[role=option]')].find(node => node.textContent.trim() === ${JSON.stringify(value)}).click()`)
  await waitFor("!document.querySelector('[role=listbox]')")
}
async function settings() { return js("window.offkey.invoke('store:use','get')") }
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => done({ cancel: true }))
  win = new BrowserWindow({ width: 1080, height: 750, show: false })
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) console.error(message) })
  await win.loadFile(path.resolve(__dirname, '../../.build/ui-review/hub.html'), { hash: '/history' })
  await waitFor("document.querySelectorAll('.history-item').length === 3")
  await js("window.offkey.invoke('store:use','patch',{historyEnabled:true,historyRetentionDays:0})")
  await js("window.offkey.invoke('db:history-delete','history-3')")
  await js("[...document.querySelectorAll('[role=tab]')].find(node=>node.textContent==='问任何问题').click()")
  await waitFor("!!document.querySelector('.history-empty')")
  await choose('24 小时')
  await waitFor("!!document.querySelector('[role=alertdialog]')")
  assert.equal((await settings()).historyRetentionDays, 0)
  await js("document.querySelector('.confirmation-cancel').click()")
  assert.equal((await settings()).historyRetentionDays, 0)
  console.log('PASS empty filtered history still confirms retention shrink; cancel preserves settings')

  await choose('从不')
  await waitFor("document.querySelector('.history-retention .hub-select').textContent.includes('从不')")
  await choose('24 小时')
  await waitFor("!!document.querySelector('[role=alertdialog]')")
  assert.equal((await settings()).historyEnabled, false)
  await js("document.querySelector('.confirmation-submit').click()")
  await waitFor("!document.querySelector('[role=alertdialog]')")
  assert.equal((await settings()).historyEnabled, true)
  assert.equal((await settings()).historyRetentionDays, 1)
  assert.equal(await js("window.offkey.invoke('db:history-list').then(result => result.total)"), 0)
  console.log('PASS re-enabling finite retention confirms before saving and deleting old records')

  await choose('永远')
  await waitFor("document.querySelector('.history-retention .hub-select').textContent.includes('永远')")
  await choose('24 小时')
  await waitFor("document.querySelector('.history-retention .hub-select').textContent.includes('24 小时')")
  assert.equal(await js("!!document.querySelector('[role=alertdialog]')"), false)
  console.log('PASS truly empty history can change retention without a deletion prompt')
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  win?.destroy()
  app.exit(process.exitCode || 0)
})
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }))
