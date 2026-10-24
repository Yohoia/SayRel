// Run after scripts/ui-build.mjs. Measures one local, visible Electron UI sample.
const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir, cpus, release } = require('node:os')
const assert = require('node:assert/strict')

const root = resolve(__dirname, '../../..')
const output = join(root, 'docs/ui-evidence/home-performance')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-home-performance-'))
const errors = []
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let win
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
const js = code => win.webContents.executeJavaScript(code)
async function until(expression) {
  for (let i = 0; i < 120; i++) {
    if (await js(expression)) return
    await wait(50)
  }
  throw new Error('Timed out: ' + expression)
}
async function metrics() {
  const { metrics } = await win.webContents.debugger.sendCommand('Performance.getMetrics')
  return Object.fromEntries(metrics.map(metric => [metric.name, metric.value]))
}

app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }))
  win = new BrowserWindow({ width: 1080, height: 750, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } })
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message) })
  win.webContents.on('render-process-gone', (_, details) => errors.push(JSON.stringify(details)))
  await win.loadFile(join(root, '.build/ui-review/hub.html'), { hash: '/dashboard' })
  win.showInactive()
  await until("!!document.querySelector('.home-speech-bar')")
  await js("window.sayrel.invoke('store:use','patch',{language:'zh-CN'})")
  await js('document.fonts.ready')
  await until("document.documentElement.lang === 'zh-CN' && document.querySelector('.home-speech-flow')?.dataset.paused === 'false'")
  await until("Number(document.querySelector('.home-speech-flow').dataset.flowTime) > 7500")
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Performance.enable')
  const before = await metrics()
  const sample = await js(`new Promise(resolve => {
    const flow = document.querySelector('.home-speech-flow');
    const stream = document.querySelector('.home-speech-raw text');
    const initialTime = Number(flow.dataset.flowTime), initialOffset = stream.getBoundingClientRect().x;
    const intervals = [], longTasks = [], start = performance.now();
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
    observer.observe({type:'longtask'});
    let previous;
    function tick(now) {
      if (previous !== undefined) intervals.push(now - previous);
      previous = now;
      if (now - start < 12000) { requestAnimationFrame(tick); return; }
      longTasks.push(...observer.takeRecords().map(entry => entry.duration));
      observer.disconnect();
      const sorted = intervals.slice().sort((a,b) => a-b);
      const median = sorted[Math.floor(sorted.length * .5)];
      resolve({durationMs:now-start, frames:intervals.length, medianIntervalMs:median,
        p95IntervalMs:sorted[Math.floor(sorted.length * .95)], maxIntervalMs:sorted.at(-1),
        intervalsAbove1_5xMedian:intervals.filter(value=>value>median*1.5).length,
        longTaskCount:longTasks.length, longTaskTotalMs:longTasks.reduce((a,b)=>a+b,0),
        flowElapsedMs:Number(flow.dataset.flowTime)-initialTime,
        pathMoved:Math.abs(stream.getBoundingClientRect().x-initialOffset)>1, glyphs:stream.textContent.length,
        compositionPaths:document.querySelectorAll('.home-speech-lottie svg path').length,
        visibility:document.visibilityState, paused:flow.dataset.paused});
    }
    requestAnimationFrame(tick);
  })`)
  const after = await metrics()
  assert.equal(sample.visibility, 'visible')
  assert.equal(sample.paused, 'false')
  assert.ok(sample.flowElapsedMs > 10000 && sample.pathMoved && sample.glyphs > 0, 'the full SVG animation ran during measurement')
  assert.ok(sample.compositionPaths > 23, 'the complete source composition rendered')
  await js("document.querySelector('.home-speech-bar').click()")
  await until("document.querySelector('.home-speech-flow').dataset.paused === 'true'")
  const pausedTime = await js("document.querySelector('.home-speech-flow').dataset.flowTime")
  const pausedBefore = await metrics()
  await wait(3000)
  const pausedAfter = await metrics()
  assert.equal(await js("document.querySelector('.home-speech-flow').dataset.flowTime"), pausedTime, 'paused animation stops advancing')
  assert.deepEqual(errors, [], 'no renderer errors')
  const elapsedSeconds = after.Timestamp - before.Timestamp
  const report = {
    scope: 'One 12-second warm, visible 1080x750 Chinese homepage sample; isolated production UI review bundle, no microphone or model calls. Frame intervals are requestAnimationFrame cadence, not GPU presentation or whole-app CPU.',
    environment: { electron: process.versions.electron, chromium: process.versions.chrome, cpu: cpus()[0].model, cores: cpus().length, os: `${process.platform} ${release()}` },
    ...sample,
    mainThreadBusyPercent: 100 * (after.TaskDuration - before.TaskDuration) / elapsedSeconds,
    scriptMs: 1000 * (after.ScriptDuration - before.ScriptDuration),
    layoutMs: 1000 * (after.LayoutDuration - before.LayoutDuration),
    styleMs: 1000 * (after.RecalcStyleDuration - before.RecalcStyleDuration),
    heapUsedMiB: after.JSHeapUsedSize / 1024 / 1024,
    pausedMainThreadBusyPercent: 100 * (pausedAfter.TaskDuration - pausedBefore.TaskDuration) / (pausedAfter.Timestamp - pausedBefore.Timestamp),
    errors
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  if (win && !win.isDestroyed()) win.destroy()
  app.quit()
})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
