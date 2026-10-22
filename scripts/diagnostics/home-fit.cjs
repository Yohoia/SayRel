const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '../..'), output = join(root, 'docs/ui-evidence/home-fit')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-home-fit-'))
app.setPath('userData', profile)
let win
const reports = []
const js = expression => win.webContents.executeJavaScript(expression)
async function until(expression) {
  for (let i = 0; i < 100; i++) {
    if (await js(expression)) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error('Timed out: ' + expression)
}
app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }))
  win = new BrowserWindow({ width:1080, height:750, useContentSize:true, show:false, webPreferences:{backgroundThrottling:false} })
  await win.loadFile(join(root,'.build/ui-review/hub.html'),{hash:'/dashboard'})
  await until("!!document.querySelector('.home-headline')")
  for (const language of ['en','zh-CN']) {
    await js(`window.sayrel.invoke('store:use','patch',{language:${JSON.stringify(language)}})`)
    await until(`document.documentElement.lang===${JSON.stringify(language)}`)
    await until(language==='zh-CN' ? "document.querySelector('.home-headline').textContent.includes('开口')" : "document.querySelector('.home-headline').textContent.includes('Speak freely.')")
    if(language==='zh-CN') await js("document.fonts.load('400 100px \"Nanxi Chuxia Song\"',document.querySelector('.home-headline').textContent).then(()=>true)")
    await js('document.fonts.ready')
    await js("Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>null))).then(()=>true)")
    for (const [width,height] of [[988,685],[1080,750],[1280,720],[1440,900],[1920,1080],[1440,700]]) {
      win.setContentSize(width,height)
      await until(`innerWidth===${width}&&innerHeight===${height}`)
      await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))')
      const report = await js(`(() => {const content=document.querySelector('.app-content'),names=['.home-headline','.home-intro','.home-speech-flow','.home-shortcuts','.home-footer'];return {width:innerWidth,height:innerHeight,overflow:content.scrollHeight-content.clientHeight,items:names.map(name=>{const el=document.querySelector(name);if(!el)return null;const r=el.getBoundingClientRect();return {name,top:r.top,bottom:r.bottom,height:r.height}}).filter(Boolean)}})()`)
      const spacing = await js(`(() => {const pill=[...document.querySelectorAll('.home-speech-lottie path[fill="rgb(254,254,233)"]')].map(p=>p.getBoundingClientRect()).find(r=>r.height>0);const keys=document.querySelector('.home-shortcuts').getBoundingClientRect(),footer=document.querySelector('.home-footer').getBoundingClientRect();return pill?{above:keys.top-pill.bottom,below:footer.top-keys.bottom}:null})()`)
      assert.ok(spacing && spacing.above>=0 && Math.abs(spacing.above-spacing.below)<2,'shortcut spacing stays equal above and below')
      reports.push({language,...report,spacing})
      console.log(language,width,height,JSON.stringify(report))
      if (!process.env.SAYREL_FIT_BASELINE) {
        assert.ok(report.overflow<=1,language+' '+width+'×'+height+' fits one screen')
        assert.ok(report.items.every(item=>item.top>=0&&item.bottom<=height), 'all home sections stay in the viewport')
        assert.ok(report.items.slice(1).every((item,i)=>item.top>=report.items[i].bottom-15), 'home sections do not overlap')
        assert.ok(report.items.find(item=>item.name==='.home-speech-flow').height>=100, 'animation remains readable')
      }
      writeFileSync(join(output,`${language}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG())
    }
  }
  writeFileSync(join(output,'report.json'),JSON.stringify(reports,null,2))
}).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{win?.destroy();app.exit(process.exitCode||0)})
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}))
