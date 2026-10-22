const { app, BrowserWindow, session } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '../..')
const profile = mkdtempSync(join(tmpdir(), 'sayrel-language-'))
const output = join(root, 'docs/ui-evidence/language')
let win
app.setPath('userData', profile)
const js = expression => win.webContents.executeJavaScript(expression)
async function until(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await js(expression)) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error('Timed out: ' + expression)
}
async function shot(name) {
  await js('document.fonts.ready')
  await js('Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => null)))')
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await js('document.documentElement.scrollWidth > innerWidth'), false, name + ' has no horizontal overflow')
  if (await js("document.documentElement.lang === 'zh-CN'")) await verifyChineseFont(name)
  writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
  console.log('PASS ' + name)
}
async function verifyChineseFont(name) {
  const count = await js(`(async () => {
    const samples = new Map();
    for (const element of document.querySelectorAll('body *')) {
      if (['SCRIPT','STYLE'].includes(element.tagName)) continue;
      const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('')
        + (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value + element.placeholder : '');
      const han = text.match(/\\p{Script=Han}/gu)?.join('');
      if (!han) continue;
      const style = getComputedStyle(element);
      const font = [style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.fontStretch];
      const key = JSON.stringify(font);
      const sample = samples.get(key) ?? {font, text:''};
      sample.text += han;
      samples.set(key, sample);
    }
    let index = 0;
    for (const {font, text} of samples.values()) {
      const probe = document.createElement('span');
      probe.dataset.chineseFontProbe = String(index++);
      probe.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
      [probe.style.fontFamily, probe.style.fontSize, probe.style.fontWeight, probe.style.fontStyle, probe.style.fontStretch] = font;
      probe.textContent = [...new Set(text)].join('');
      document.body.append(probe);
    }
    await document.fonts.ready;
    return index;
  })()`)
  assert.ok(count > 0, name + ' includes Chinese font samples')
  try {
    const { root:documentNode } = await win.webContents.debugger.sendCommand('DOM.getDocument')
    for (let index = 0; index < count; index++) {
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId:documentNode.nodeId, selector:`[data-chinese-font-probe="${index}"]` })
      const { fonts } = await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId })
      assert.ok(fonts.length > 0, name + ' renders Chinese glyphs')
      assert.ok(fonts.every(font => font.isCustomFont && ['MiSans', 'MiSans Medium'].includes(font.familyName)), name + ' Chinese uses embedded MiSans: ' + JSON.stringify(fonts))
    }
  } finally {
    await js("document.querySelectorAll('[data-chinese-font-probe]').forEach(node => node.remove())")
  }
}
app.whenReady().then(async () => {
  mkdirSync(output, { recursive: true })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }))
  win = new BrowserWindow({ width:1080, height:750, show:false, webPreferences:{ backgroundThrottling:false } })
  await win.loadFile(join(root, '.build/ui-review/hub.html'))
  await until("!!document.querySelector('.home-headline')")
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('DOM.enable')
  await win.webContents.debugger.sendCommand('CSS.enable')
  await js("document.querySelector('.home-settings').click()")
  await until("!!document.querySelector('.hub-select[aria-label=\"Interface language\"]')")
  await js("document.querySelector('.hub-select[aria-label=\"Interface language\"]').click()")
  await until("!!document.querySelector('.hub-select-menu')")
  await js("[...document.querySelectorAll('.hub-select-menu button')].find(button => button.textContent === new Intl.DisplayNames(['zh-CN'],{type:'language'}).of('zh-CN')).click()")
  await until("document.documentElement.lang === 'zh-CN'")
  assert.equal(await js("document.querySelector('.home-navigation a').textContent"), '首页', 'navigation follows Chinese language setting')
  assert.equal(await js("document.querySelector('.home-intro').textContent"), '用声音记录想法，在常用应用中直接输入。')
  await until("!!document.querySelector('.sayrel-toast')")
  assert.equal(await js("document.querySelector('.sayrel-toast').textContent.trim()"), '已保存')
  await shot('settings-chinese')
  await js("[...document.querySelectorAll('.settings-nav-item')].find(button => button.textContent.trim() === '关于').click()")
  await until("document.querySelector('.settings-content')?.textContent.includes('本应用使用 MiSans 字体。')")
  await shot('about-chinese')
  await js("[...document.querySelectorAll('.settings-nav-item')].find(button => button.textContent.trim() === '设置').click()")
  win.setContentSize(840,560)
  await shot('settings-chinese-840')
  win.setContentSize(1080,750)
  await js("document.querySelector('.settings-modal-close').click()")
  await shot('home-chinese')
  for (const [width, height] of [[900,650], [600,800], [1440,900]]) {
    win.setContentSize(width, height)
    await shot(`home-chinese-${width}`)
    const headline = await js("(() => { const heading=document.querySelector('.home-headline'); return {height:heading.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(heading).lineHeight)} })()")
    assert.ok(headline.height <= headline.lineHeight * 2 + 1, 'Chinese slogan remains two lines at width ' + width)
  }
  win.setContentSize(1080,750)
  for (const [route, title] of [['history','历史'], ['dictionary','词典'], ['providers','服务商']]) {
    await js(`location.hash='/${route}'`)
    await until(`document.querySelector('h1')?.textContent.includes('${title}')`)
    if (route === 'history') {
      assert.match(await js("document.querySelector('.history-item-text').textContent"), /^Hi team,/)
      assert.match(await js("document.querySelector('.history-date').textContent"), /年|今天|昨天/)
      assert.doesNotMatch(await js("document.querySelector('.history-retention').textContent"), /Keep history|Forever/)
    }
    if (route === 'dictionary') {
      await until("!!document.querySelector('.dictionary-word-name')")
      assert.ok((await js("[...document.querySelectorAll('.dictionary-word-name')].map(node=>node.textContent)")).includes('TypeScript'))
      await js("document.querySelector('.page-actions .primary-button').click()")
      await until("!!document.querySelector('.dictionary-add-modal')")
      assert.equal(await js("document.querySelector('.dictionary-add-modal .primary-button').textContent"), '添加词汇')
      await js("document.querySelector('.modal-close').click()")
    }
    if (route === 'providers') {
      await until("!!document.querySelector('.provider-card')")
      assert.match(await js("document.querySelector('.providers-tabs').textContent"), /语音转写/)
      await js("document.querySelector('[data-provider-id=\"asr-openai\"]').click()")
      await until("!!document.querySelector('.provider-dialog')")
      assert.equal(await js("document.querySelector('.provider-dialog h2').textContent"), '配置服务商')
      assert.match(await js("document.querySelector('.provider-dialog').textContent"), /保存配置/)
      await shot('provider-editor-chinese')
      await js("document.querySelector('.modal-close').click()")
    }
    await shot(route + '-chinese')
  }
  await win.loadFile(join(root, '.build/ui-review/hub.html'))
  await until("document.querySelector('.home-navigation a')?.textContent === '首页'")
  console.log('PASS Chinese language survives page reload')
  for (const [page, selector, expected] of [
    ['onboarding', '.secondary-onboarding-copy h1', '隐私'],
    ['sidebar', '.secondary-context-empty p', '光标'],
    ['interactive-card', '.secondary-answer h1', '回答'],
    ['floating-bar', '.floating-bar-surface', '轻按']
  ]) {
    await win.loadFile(join(root, `.build/ui-review/${page}.html`), page === 'floating-bar' ? {query:{state:'long-pressing'}} : {})
    await until(`document.querySelector('${selector}')?.textContent.includes('${expected}')`)
    assert.equal(await js('document.documentElement.lang'), 'zh-CN')
    if (page === 'interactive-card') assert.match(await js("document.querySelector('.secondary-answer-content').textContent"), /^Clear writing/)
    await shot(page + '-chinese')
    await js("window.sayrel.invoke('store:use','patch',{language:'en'})")
    await until("document.documentElement.lang === 'en'")
    assert.doesNotMatch(await js(`document.querySelector('${selector}').textContent`), /\p{Script=Han}/u)
    await js("window.sayrel.invoke('store:use','patch',{language:'zh-CN'})")
    await until(`document.querySelector('${selector}')?.textContent.includes('${expected}')`)
  }
  await win.loadFile(join(root, '.build/ui-review/hub.html'))
  await until("document.querySelector('.home-navigation a')?.textContent === '首页'")
  await js("window.sayrel.invoke('store:use','patch',{language:'en'})")
  await until("document.querySelector('.home-navigation a')?.textContent === 'Home'")
  await shot('home-english')
  await js("window.sayrel.invoke('store:use','patch',{language:'fr'})")
  await until("document.querySelector('.home-navigation a')?.textContent === 'Accueil'")
  await js("window.sayrel.invoke('store:use','patch',{language:'zh-CN'})")
  await until("document.querySelector('.home-navigation a')?.textContent === '首页'")
  console.log('PASS English, lazily loaded French, and Chinese switch without reloading')
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  win?.destroy()
  app.exit(process.exitCode || 0)
})
app.on('quit', () => rmSync(profile, { recursive:true, force:true, maxRetries:5, retryDelay:50 }))
