// Real offline renderer with fixture IPC: no user profile, microphone, or provider network.
const { app, BrowserWindow, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '../../..')
const output = path.join(root, 'docs/ui-evidence/recovery')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sayrel-recovery-ui-'))
const errors = [], checks = []
let win
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const js = code => win.webContents.executeJavaScript(code)
async function until(expression) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await js(expression)) return
    await wait(40)
  }
  throw new Error(`UI timeout: ${expression}\n${await js('document.body.innerText.slice(0,1500)')}`)
}
async function click(selector) {
  await until(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`)
  await js(`document.querySelector(${JSON.stringify(selector)}).click()`)
}
async function capture(name) {
  await js('document.fonts.ready')
  await wait(200)
  assert.equal(await js('document.documentElement.scrollWidth > innerWidth'), false, name + ' horizontal overflow')
  fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
}
async function page(file, scenario, hash) {
  await win.loadFile(path.join(root, '.build/ui-review', file), { query: { recovery: scenario }, ...(hash ? { hash } : {}) })
  await until('!!window.__bridge')
}
function pass(name) { checks.push(name); console.log('PASS ' + name) }

app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => done({ cancel: true }))
  win = new BrowserWindow({ width: 1180, height: 850, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } })
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message) })
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__calls=[];window.__subscribers=new Map();
    window.__scenario=new URLSearchParams(location.search).get('recovery');
    window.__fallbackIssue={kind:'refinement',message:'Text refinement failed. Your original transcript is available. Retry refinement to open the revised text in a card.',canRetry:true};
    window.__current={phase:'idle',context:{sessionId:null,mode:'voice_transcript',handsFree:false,error:null,issue:window.__scenario==='floating'?window.__fallbackIssue:null}};
    window.__emit=(channel,...args)=>{for(const callback of window.__subscribers.get(channel)||[])callback(...args)};
    window.__publish=state=>{window.__current=state;window.__emit('recording-machine:state',state)};
    window.__history={id:'fallback-no-audio',refinedText:'The original transcript remains available.',mode:'voice_transcript',status:'completed',duration:1200,createdAt:'2026-10-23T09:00:00Z',focusedAppName:'Offline fixture',audioLocalPath:null,hasAudio:false,refinement:{kind:'fallback',message:'Offline model failure'}};
    window.__credentialProfile={id:'asr-openai',presetId:'asr-openai',name:'OpenAI',service:'transcription',protocol:'openai-transcription',enabled:true,endpoint:'https://api.openai.com/v1',apiKey:'',models:['gpt-4o-mini-transcribe'],appId:'',accessToken:'',resourceId:'',apiVersion:''};
    window.__credentialState={profiles:[window.__credentialProfile],transcription:null,refinement:null};
    window.__credentialsUnavailable=['asr-openai'];
    Object.defineProperty(window,'sayrel',{configurable:true,get(){return this.__bridge},set(value){
      const invoke=value.invoke.bind(value),on=value.on.bind(value);
      value.on=(channel,callback)=>{const listeners=window.__subscribers.get(channel)||new Set();listeners.add(callback);window.__subscribers.set(channel,listeners);const off=on(channel,callback);return()=>{listeners.delete(callback);off()}};
      value.invoke=async(channel,...args)=>{
        window.__calls.push([channel,...args]);
        if(channel==='recording-machine:state')return window.__current;
        if(channel==='page:floating-bar-click'&&args[0]==='retry'){
          window.__publish({phase:'finishing',context:{sessionId:'refinement-retry',mode:'voice_transcript',handsFree:false,error:null,issue:null}});return true;
        }
        if(window.__scenario==='history'){
          if(channel==='db:history-list')return{items:[window.__history],total:1,nextCursor:null};
          if(channel==='db:history-get')return window.__history;
          if(channel==='db:history-retry')return new Promise(resolve=>{window.__finishRetry=kind=>{
            window.__history={...window.__history,refinedText:kind==='completed'?'The recovered refinement is ready.':window.__history.refinedText,refinement:kind==='completed'?{kind:'completed'}:{kind:'fallback',message:'Offline retry failure'}};
            resolve({id:window.__history.id,refinement:window.__history.refinement});
          }});
        }
        if(window.__scenario==='providers'){
          if(channel==='store:use'&&args[0]!=='patch')return{...await invoke(channel,...args),language:'en',providerCredentialsUnavailable:window.__credentialsUnavailable,serviceProviders:window.__credentialState};
          if(channel==='providers:get')return window.__credentialState;
          if(channel==='providers:manage'&&args[0]?.action==='save'){
            const next=await invoke(channel,...args);window.__credentialState=next;
            if(args[0].profile.apiKey){window.__credentialsUnavailable=[];const current=await invoke('store:use','get');window.__emit('store:changed',{...current,providerCredentialsUnavailable:[]})}
            return next;
          }
        }
        return invoke(channel,...args);
      };
      this.__bridge=value;
    }});
  ` })

  win.setContentSize(750, 500)
  await page('floating-bar.html', 'floating')
  await until("document.querySelector('.floating-alert')?.dataset.issue==='refinement'")
  assert.equal(await js("document.querySelector('[data-testid=floating-bar]').dataset.status"), 'error')
  assert.equal(await js("document.querySelector('#floating-alert-title').textContent"), 'Original transcript used')
  assert.equal(await js("document.querySelector('.floating-alert-primary').textContent"), 'Retry refinement')
  assert.equal(await js("(() => {const node=document.querySelector('.floating-alert'),rect=node.getBoundingClientRect(),style=getComputedStyle(node);return style.display!=='none'&&style.visibility==='visible'&&rect.width>0&&rect.height>0&&rect.top>=0&&rect.bottom<=innerHeight})()"), true)
  assert.equal(await js("window.__calls.some(call=>call[0]==='recording-machine:status'&&['started','chunk'].includes(call[1]))"), false)
  await capture('idle-refinement-warning')
  await click('.floating-alert-primary')
  await until("document.querySelector('[data-testid=floating-bar]').dataset.status==='recording-dictating'")
  assert.equal(await js("window.__calls.filter(call=>call[0]==='page:floating-bar-click'&&call[1]==='retry').length"), 1)
  assert.equal(await js("!!document.querySelector('.floating-alert')"), false)
  pass('idle fallback stays visible and Retry refinement dispatches one retry')

  win.setContentSize(1180, 850)
  await page('hub.html', 'history', '/history')
  await until("document.querySelectorAll('.history-item').length===1")
  assert.equal(await js("document.querySelector('.history-refinement-warning').textContent"), 'Text refinement failed. Your original transcript is available.')
  await click('[aria-label="Transcription actions"]')
  await until("[...document.querySelectorAll('[role=menuitem]')].some(node=>node.textContent==='Retry refinement')")
  assert.equal(await js("[...document.querySelectorAll('[role=menuitem]')].find(node=>node.textContent==='Retry refinement').disabled"), false)
  assert.equal(await js("[...document.querySelectorAll('[role=menuitem]')].find(node=>node.textContent.includes('Download audio')).disabled"), true)
  await capture('history-fallback-no-audio')
  await js("[...document.querySelectorAll('[role=menuitem]')].find(node=>node.textContent==='Retry refinement').click()")
  await until("document.querySelector('.history-item-text').textContent.includes('Retrying refinement…')&&typeof window.__finishRetry==='function'")
  assert.deepEqual(await js("window.__calls.filter(call=>call[0]==='db:history-retry')"), [['db:history-retry', 'fallback-no-audio']])
  assert.equal(await js("document.querySelector('.history-item-text').textContent.includes('Reprocessing audio')"), false)
  await js("window.__finishRetry('completed')")
  await until("document.querySelector('.history-item-text').textContent.includes('The recovered refinement is ready.')")
  await until("[...document.querySelectorAll('.sayrel-toast')].some(node=>node.textContent.includes('Refinement completed'))")
  assert.equal(await js("!!document.querySelector('.history-refinement-warning')"), false)
  pass('history without audio enables refinement retry and reports refinement completion')

  await page('hub.html', 'history', '/history')
  await until("!!document.querySelector('.history-refinement-warning')")
  await click('[aria-label="Transcription actions"]')
  await js("[...document.querySelectorAll('[role=menuitem]')].find(node=>node.textContent==='Retry refinement').click()")
  await until("typeof window.__finishRetry==='function'")
  await js("window.__finishRetry('fallback')")
  await until("[...document.querySelectorAll('.sayrel-toast.is-error')].some(node=>node.textContent.includes('Text refinement failed. Your original transcript is available.'))")
  assert.equal(await js("[...document.querySelectorAll('.sayrel-toast')].some(node=>node.textContent.includes('Refinement completed'))"), false)
  assert.equal(await js("!!document.querySelector('.history-refinement-warning')"), true)
  pass('failed history refinement retains warning and reports failure without a success toast')

  await page('hub.html', 'providers', '/providers')
  await until("!!document.querySelector('[data-provider-id=asr-openai]')")
  await until("[...document.querySelectorAll('.providers-page-error[role=alert]')].some(node=>node.textContent.includes('Some saved credentials could not be unlocked.'))")
  assert.equal(await js("document.querySelector('[data-provider-id=asr-openai] .provider-card-bottom').textContent.includes('Re-enter credentials')"), true)
  await capture('provider-credentials-unavailable')
  await click('[data-provider-id="asr-openai"]')
  await until("!!document.querySelector('input[name=apiKey]')")
  assert.equal(await js("document.querySelector('input[name=apiKey]').value"), '')
  assert.equal(await js("document.querySelector('input[name=apiKey]').disabled"), false)
  await js("(() => {const input=document.querySelector('input[name=apiKey]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'offline-replacement');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await click('.provider-editor-footer button[type=submit]')
  await until("!document.querySelector('.provider-dialog')")
  assert.equal(await js("window.__calls.some(call=>call[0]==='providers:manage'&&call[1]?.action==='save'&&call[1].profile.apiKey==='offline-replacement')"), true)
  await until("![...document.querySelectorAll('.providers-page-error[role=alert]')].some(node=>node.textContent.includes('Some saved credentials could not be unlocked.'))")
  pass('unavailable credentials display page and card warnings with a working refill entry')

  assert.deepEqual(errors, [])
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks, errors, scope: 'Real offline renderer, isolated profile and IPC boundaries; no microphone, user credentials or online requests.' }, null, 2))
  console.log(`Recovery UI: ${checks.length} behavioral checks passed.`)
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  win?.destroy()
  app.exit(process.exitCode || 0)
})
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }))
