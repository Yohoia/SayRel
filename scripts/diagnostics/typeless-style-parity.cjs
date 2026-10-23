// Compare project code against isolated pure functions extracted from the shipped artifact.
// No Typeless bootstrap, native code, hardware or network executes.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict'), ts = require('typescript')
const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default
const root = path.resolve(__dirname, '../..'), reference = path.join(root, '.build/typeless-floating')
function declarations(file, names) {
  const source = fs.readFileSync(path.join(reference, file + '.js'), 'utf8')
  const found = new Map()
  traverse(parse(source, { sourceType:'module' }), { VariableDeclarator(p) {
    if (!p.getFunctionParent() && names.includes(p.node.id.name)) found.set(p.node.id.name, source.slice(p.node.init.start, p.node.init.end))
  } })
  for (const name of names) assert.ok(found.has(name), name + ' exists in reference')
  return names.map(name => `const ${name}=${found.get(name)};`).join('\n')
}
function project(file, additions = '', mocks = {}, environment = {}) {
  const exports = {}
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX } }).outputText
  const req = id => id in mocks ? mocks[id] : id === './appearance' ? project('src/renderer/floating-bar/appearance.ts')
    : id.endsWith('/recordingFeedback') ? { recordingIssueSchema:require('zod').z.unknown() }
    : id === 'react' ? { useId:()=>'fixture' } : ['zod', 'react/jsx-runtime'].includes(id) ? require(id) : {}
  vm.runInNewContext(source + additions, { exports, require:req, console, window:{}, document:{}, performance, setTimeout, clearTimeout, ...environment })
  return exports
}
const styles = project('src/renderer/floating-bar/App.tsx', '\nexports.style=computeStyle;')
const pure = declarations('floating', ['_a', 'ma', 'je', 'gr', 'Ta'])
const statuses = ['hover', 'starting-microphone', 'recording', 'hands-free', 'recording-dictating', 'error']
for (const status of statuses) for (const countdown of [false, true]) {
  let hook = 0
  const finishing = status.endsWith('dictating'), handsFree = status.startsWith('hands-free')
  const matches = state => typeof state === 'object' ? handsFree : ({ idle:status==='hover', finishing, error:status==='error', failure:false, long_pressing:false })[state] ?? false
  const context = {
    _0x4351da:{ useState:value=>[hook++===0 ? status==='hover' : value, ()=>{}], useMemo:fn=>fn(), useRef:value=>({ current:value===false ? true : value }), useEffect:()=>{}, useCallback:fn=>fn },
    _0x3c0c98:()=>({appSettings:{}}), _0x21831a:()=>({ loaded:true,isLogin:true }), _0x400730:()=>({}), _0x223338:()=>({retryState:{}}), _0xaa38ad:()=>({}),
    ga:()=>({ state:{ matches,context:{ recorderState:{isStartingMicrophone:status==='starting-microphone'},recorderTimeoutState:countdown?{ remainingTime:25,timeUntilCountdown:0 }:null } },send:()=>{} }),
    Ea:class{}, Date, Math
  }
  const expected = vm.runInNewContext(pure + ';ma().state.voiceRecordingControlState.sx', context)
  const actual = styles.style(status, countdown)
  // Ia overrides the base-state width while Thinking is shown.
  if (finishing) expected.width = 92
  const number = value => typeof value === 'string' && /^\d+px$/.test(value) ? parseFloat(value) : value
  for (const key of ['width', 'height', 'borderRadius', 'opacity']) assert.equal(number(actual[key]), number(expected[key]), `${status}, countdown=${countdown}: ${key}`)
  const padding = value => { const [y,x=y]=value.split(' ');return [y,x,y,x] }
  assert.deepEqual(padding(actual.padding), padding(expected.padding), status + ' padding')
  if (!finishing) assert.equal(actual.transition, expected.transition)
  const shadow = value => value.replaceAll(' ', '').replace(/;$/, '').replace(/(?<=[,(])\.(\d+)/g, '0.$1')
  assert.equal(shadow(actual.boxShadow), shadow(expected.boxShadow))
}
const progress = project('src/renderer/floating-bar/useProcessingAnimation.ts').processingProgress
for (const seconds of [0,.1,.5,1,1.4,2,2.7,3,4,5,6,9,10,20]) {
  assert.equal(progress(seconds), vm.runInNewContext(pure + ';Ta(seconds)', { seconds }))
}
const shimmerSource = fs.readFileSync(path.join(reference, 'floating.js'), 'utf8')
assert.ok(shimmerSource.includes('"92px"') && shimmerSource.includes('}, 350)'))
console.log('PASS 12 reachable source-derived bar states, roundness, padding, shadows, transitions and 14 progress samples')

const glow=project('src/renderer/floating-bar/VolumeGlow.tsx').VolumeGlow
function maskPath(node){
  if(!node||typeof node!=='object')return null
  if(node.type==='mask')return node.props.children.props.d
  for(const child of [node.props?.children].flat(Infinity)){const found=maskPath(child);if(found)return found}
  return null
}
for(const volume of [0,.1,.35,.7,1]){
  const original=vm.runInNewContext(declarations('shared',['Xr'])+';Xr({themeId:"blue"})',{
    _0x2f96ea:{useId:()=>'fixture'},As:()=>volume,_0x2353be:'div',_0x2d10ab:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},Math
  })
  const numbers=value=>value.match(/-?\d+(?:\.\d+)?/g).map(Number)
  assert.deepEqual(numbers(maskPath(glow({volume}))),numbers(maskPath(original)))
}
console.log('PASS original audio-reactive mask geometry at five volume levels')

const nativeSource=fs.readFileSync(path.join(reference,'main.js'),'utf8')
const nativeAst=parse(nativeSource,{sourceType:'module'})
const classes=['cg','Ef'].map(name=>{
  const node=nativeAst.program.body.find(n=>n.type==='ClassDeclaration'&&n.id.name===name)
  assert.ok(node,name+' native class exists')
  return nativeSource.slice(node.start,node.end)
}).join('\n')
const constants=declarations('main',['qn','Kn','rg','og','If','Ia','Tf','Sf','kf','Ta'])
for(const area of [{x:0,y:25,width:1440,height:875},{x:1440,y:-900,width:1920,height:1080},{x:-1280,y:0,width:1280,height:700}]){
  const display={id:1,workArea:area}
  const screen={getPrimaryDisplay:()=>display,getAllDisplays:()=>[display],getCursorScreenPoint:()=>({x:area.x+100,y:area.y+100}),getDisplayNearestPoint:()=>display}
  let expectedBounds,actualBounds
  const referenceWindow={isDestroyed:()=>false,getBounds:()=>({x:0,y:0,width:800,height:500}),setBounds:b=>{expectedBounds=b}}
  const actualWindow={...referenceWindow,setBounds:b=>{actualBounds=b}}
  const originalTimers=[], projectTimers=[]
  class ReferenceBase{getWindow(){return referenceWindow}}
  class ProjectBase{getWindow(){return actualWindow}}
  const original=vm.runInNewContext(constants+'\n'+classes+';({bar:new cg(),card:new Ef()})',{
    _s:ReferenceBase,g:(object,key,value)=>{object[key]=value},_0x54c8a6:()=>'',_0x4963:()=>'',_0x51cd79:screen,_0x5645a9:{isPackaged:true},cs:{},ag:'fixture',vf:'fixture',
    setTimeout:fn=>{originalTimers.push(fn);return originalTimers.length},clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},me:()=>'',Math,Number
  })
  const mocks={electron:{screen},'./base':{BaseWindow:ProjectBase},'../../shared/constants':{WINDOWS:{}},'../lib/logger':{createLogger:()=>({warn:()=>{}})}}
  const environment={setTimeout:fn=>{projectTimers.push(fn);return projectTimers.length},clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{}}
  const bar=new (project('src/main/windows/floatingBar.ts','',mocks,environment).FloatingBarWindow)()
  const card=project('src/main/windows/secondary.ts','',mocks,environment).interactiveCardWindow
  for(const key of ['width','height','type','frame','transparent','hasShadow','focusable','resizable','maximizable','minimizable']) assert.equal(bar.getWindowOptions()[key],original.bar.getWindowOptions()[key],'bar option '+key)
  original.bar.currentDisplay=display;bar.currentDisplayId=1
  original.bar.moveWindowToDisplay(display);bar.moveWindowToDisplay(1)
  assert.deepEqual(JSON.parse(JSON.stringify(actualBounds)),JSON.parse(JSON.stringify(expectedBounds)))
  original.bar.setExpanded(false);bar.setExpanded(false)
  assert.deepEqual(JSON.parse(JSON.stringify(actualBounds)),JSON.parse(JSON.stringify(expectedBounds)))
  original.bar.setExpanded(true);bar.setExpanded(true)
  assert.deepEqual(JSON.parse(JSON.stringify(actualBounds)),JSON.parse(JSON.stringify(expectedBounds)))
  assert.deepEqual(JSON.parse(JSON.stringify(card.computeInitialBounds())),JSON.parse(JSON.stringify(original.card.computeInitialBounds())))
  for(const height of [488,600,788,999]){
    original.card.applyContentBounds(height);card.updateBounds({height})
    originalTimers.shift()();projectTimers.shift()()
    assert.deepEqual(JSON.parse(JSON.stringify(actualBounds)),JSON.parse(JSON.stringify(expectedBounds)),'reply content bounds '+height)
  }
}
console.log('PASS native window options, 750×500 expansion, 1×1 collapse, and 800px reply bounds on three displays')
