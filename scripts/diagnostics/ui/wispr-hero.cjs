// Original full-player expression vs the production React component's CSP-safe data.
// Run after scripts/ui-build.mjs. No profile, microphone or external requests.
const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '../../..'), output = join(root, 'docs/ui-evidence/wispr-hero')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-wispr-hero-'))
app.setPath('userData', profile)
const windows = [], errors = [], comparisons = []
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const js = (win, code) => win.webContents.executeJavaScript(code)
async function until(win, code) {
  for (let i = 0; i < 160; i++) { if (await js(win, code)) return; await wait(40) }
  throw new Error('Timed out: ' + code)
}
const player = "window.__heroPlayer.getRegisteredAnimations()[0]"
app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }))
  const win = new BrowserWindow({width:1080,height:750,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}})
  windows.push(win)
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message) })
  await win.loadFile(join(root, '.build/ui-review/hub.html'), { hash: '/dashboard' })
  await until(win, "document.querySelector('.home-speech-flow')?.dataset.ready === 'true'")
  await js(win, 'document.fonts.ready')
  assert.equal(await js(win, `${player}.totalFrames`), 1388)
  assert.equal(await js(win, `${player}.frameRate`), 30)
  assert.equal(await js(win, "document.querySelector('.home-speech-lottie svg').getAttribute('viewBox')"), '0 0 269 161')
  assert.equal(await js(win, "document.querySelectorAll('.home-speech-paths textPath').length"), 2)
  const palette = await js(win, `(() => {
    const probe=document.createElement('span');probe.style.color='var(--accent)';document.body.append(probe);
    const accent=getComputedStyle(probe).color;probe.remove();
    return {accent,raw:getComputedStyle(document.querySelector('.home-speech-raw textPath')).fill,
      ribbon:getComputedStyle(document.querySelector('.home-speech-clean path')).stroke,
      capsule:getComputedStyle(document.querySelector('.home-speech-lottie svg>g [fill="rgb(254,254,233)"]')).fill,
      waveform:getComputedStyle(document.querySelector('.home-speech-lottie svg>g [fill="rgb(26,26,26)"]')).fill,
      keyGap:document.querySelector('.home-shortcuts').getBoundingClientRect().top-document.querySelector('.home-speech-flow').getBoundingClientRect().bottom};
  })()`)
  assert.equal(palette.raw,palette.accent)
  assert.equal(palette.ribbon,palette.accent)
  assert.equal(palette.waveform,palette.accent)
  assert.notEqual(palette.capsule,palette.waveform,'waveform contrasts with the capsule background')
  assert.ok(palette.keyGap>=8,'shortcuts sit below the animation')
  assert.deepEqual(await js(win, "[...document.querySelectorAll('.home-speech-paths animate')].map(a=>[a.getAttribute('dur'),a.getAttribute('values')])"), [['35s','-2947;0'],['60s','-4018;0']])
  assert.equal(await js(win, "[...document.querySelectorAll('.home-speech-paths svg')].every(s=>s.getAttribute('preserveAspectRatio')!=='none')"), true)
  const original = readFileSync(join(root, 'src/renderer/hub/assets/wispr-hero.json'), 'utf8')
  const refFile = join(profile, 'reference.html')
  writeFileSync(refFile, `<html><body><div id="animation"></div><script src="${pathToFileURL(join(root,'node_modules/lottie-web/build/player/lottie.js'))}"></script><script>window.reference=lottie.loadAnimation({container:document.querySelector('#animation'),renderer:'svg',loop:true,autoplay:false,animationData:${original},rendererSettings:{preserveAspectRatio:'xMidYMid meet',progressiveLoad:false}})</script></body></html>`)
  const ref = new BrowserWindow({width:1080,height:750,show:false,webPreferences:{backgroundThrottling:false}})
  windows.push(ref)
  await ref.loadFile(refFile)
  await until(ref, 'window.reference?.isLoaded')
  // Compare the real generated SVG paint tree, ignoring only generated clip IDs.
  const snapshot = selector => `(() => { const svg=document.querySelector(${JSON.stringify(selector)}).cloneNode(true); svg.querySelectorAll('g').forEach(g=>{if(g.style.display==='none'||g.getAttribute('opacity')==='0')g.remove()});[svg,...svg.querySelectorAll('*')].forEach(el=>{const attrs=[...el.attributes].map(a=>[a.name,a.value]).sort((a,b)=>a[0].localeCompare(b[0]));attrs.forEach(([name])=>el.removeAttribute(name));attrs.forEach(([name,value])=>el.setAttribute(name,value))});return svg.outerHTML.replace(/__lottie_element_\\d+/g,'__lottie_element_ID') })()`
  const frames = [0, 1, 72, 73, 74, 100, 130, 145, 146, 147, 180, 210, 250, 310, 350, 380, 430, 480, 550, 600, 650, 700, 780, 830, 900, 960, 1020, 1080, 1140, 1205, 1206, 1230, 1300, 1387]
  for (const frame of frames) {
    await js(win, `${player}.goToAndStop(${frame},true)`)
    await js(ref, `window.reference.goToAndStop(${frame},true)`)
    const actual = await js(win, snapshot('.home-speech-lottie>svg'))
    const expected = await js(ref, snapshot('#animation>svg'))
    if (actual !== expected) {
      writeFileSync(join(output, `actual-${frame}.svg`), actual)
      writeFileSync(join(output, `reference-${frame}.svg`), expected)
    }
    comparisons.push({ frame, equal: actual === expected })
    const numberPattern = /[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi
    const aNumbers = [...actual.matchAll(numberPattern)].map(m=>Number(m[0]))
    const bNumbers = [...expected.matchAll(numberPattern)].map(m=>Number(m[0]))
    assert.equal(actual.replace(numberPattern,'#'), expected.replace(numberPattern,'#'), 'same SVG structure at frame '+frame)
    assert.equal(aNumbers.length,bNumbers.length)
    let maxDelta=0
    aNumbers.forEach((value,i)=>{
      const delta=Math.abs(value-bNumbers[i]);maxDelta=Math.max(maxDelta,delta)
      // Both renderers store geometry in Float32. Allow four Float32 ULPs.
      assert.ok(delta <= 4 * 2**-23 * Math.max(1,Math.abs(value),Math.abs(bNumbers[i])), 'Float32 geometry at frame '+frame)
    })
    comparisons.at(-1).maxGeometryDelta=maxDelta
  }
  console.log('PASS original expression and production SVG match at Float32 precision at ' + frames.length + ' frames')
  for (const [frame, name] of [[140,'grammar'],[255,'saved-name'],[400,'filler'],[600,'question-mark'],[850,'split-sentence'],[1060,'repetition']]) {
    await js(win, `${player}.goToAndStop(${frame},true)`)
    await js(win, 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))')
    writeFileSync(join(output, name+'.png'), (await win.webContents.capturePage()).toPNG())
  }
  await js(win, "document.querySelector('.home-speech-bar').click()")
  assert.equal(await js(win, "document.querySelector('.home-speech-flow').dataset.paused"), 'true')
  const pausedFrame = await js(win, `${player}.currentFrame`)
  const pausedPaths = await js(win, "[...document.querySelectorAll('.home-speech-paths svg')].map(s=>s.getCurrentTime())")
  await wait(250)
  assert.equal(await js(win, `${player}.currentFrame`), pausedFrame)
  assert.deepEqual(await js(win, "[...document.querySelectorAll('.home-speech-paths svg')].map(s=>s.getCurrentTime())"), pausedPaths)
  await js(win, "document.querySelector('.home-speech-bar').click()")
  await until(win, `${player}.currentFrame > ${pausedFrame}`)
  await js(win, `${player}.goToAndStop(1386,true); ${player}.play()`)
  await until(win, `${player}.currentFrame < 20`)
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await until(win, "document.querySelector('.home-speech-flow').dataset.paused==='true'")
  assert.equal(await js(win, `${player}.isPaused`), true)
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[]})
  await until(win, `${player}.isPaused===false`)
  await js(win, "document.querySelector('.home-navigation a[href=\"#/statistics\"]').click()")
  await until(win, "window.__heroPlayer.getRegisteredAnimations().length===0")
  await js(win, "document.querySelector('.home-navigation a[href=\"#/dashboard\"]').click()")
  await until(win, "document.querySelector('.home-speech-flow')?.dataset.ready==='true'")
  assert.equal(await js(win, 'window.__heroPlayer.getRegisteredAnimations().length'), 1)
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'report.json'), JSON.stringify({ comparisons, errors, checks:['original data vs CSP-safe React SVG at source frames','two original SMIL paths and periods','all six editing sequences','pause and resume preserve waveform and SMIL time','loop wraps at 1388 frames','reduced motion','route disposal and remount','network blocked'] },null,2))
  console.log('PASS pause, resume, loop, reduced motion, route cleanup and offline rendering')
}).catch(error=>{console.error(error.message.slice(0,2000));process.exitCode=1}).finally(()=>{windows.forEach(w=>w.destroy());app.exit(process.exitCode||0)})
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}))
