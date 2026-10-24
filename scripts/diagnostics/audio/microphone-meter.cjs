// Compare the shipped Rf/uo functions with the app, without hardware or Electron.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict')
const {parse}=require('@babel/parser'),traverse=require('@babel/traverse').default
const root=path.resolve(__dirname,'../../..'),folder=path.join(root,'.build/typeless-floating')
function declaration(file,name){const source=fs.readFileSync(path.join(folder,file+'.js'),'utf8');let code;traverse(parse(source,{sourceType:'module'}),{VariableDeclarator(p){if(!p.getFunctionParent()&&p.node.id.name===name)code=source.slice(p.node.init.start,p.node.init.end)}});assert.ok(code);return `const ${name}=${code};`}
function project(file,mocks){const exports={};const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;return {exports,run:context=>vm.runInNewContext(source,{exports,require:id=>mocks[id]??(id==='react/jsx-runtime'?require(id):{}),...context})}}
function volumes(original,sensitivity){
  const callbacks=[],effects=[],values=[];let tick,level=0,disconnected=0
  const analyser={frequencyBinCount:512,getFloatTimeDomainData:a=>a.fill(level),connect(){},disconnect(){disconnected++}}
  const context={state:'running',createAnalyser:()=>analyser,createMediaStreamSource:()=>({connect(){},disconnect(){disconnected++}})}
  analyser.context=context
  const react={useRef:v=>({current:v}),useState:v=>[v,next=>values.push(next)],useEffect:fn=>effects.push(fn)}
  const timers={setTimeout:fn=>{callbacks.push(fn);return 1},clearTimeout(){},setInterval:fn=>{tick=fn;return 2},clearInterval(){}}
  if(original)vm.runInNewContext(declaration('shared','Rf')+';Rf({mediaStream:{id:"fixture",getTracks:()=>[{readyState:"live"}]},sensitivity});',{_0x2f96ea:react,dt:{getAudioContext:()=>context},sensitivity,Float32Array,...timers})
  else{const app=project('src/renderer/shared/audio/useMicrophoneVolume.ts',{react});app.run({window:timers,Float32Array,ArrayBuffer});app.exports.useMicrophoneVolume(analyser,sensitivity)}
  const cleanups=effects.map(fn=>fn());callbacks.forEach(fn=>fn())
  assert.equal(analyser.fftSize,1024);assert.equal(analyser.smoothingTimeConstant,.8)
  for(const value of [0,.003,.0033,.0036,.004,.01,.1,...Array(50).fill(0)]){level=value;tick()}
  cleanups.forEach(fn=>fn?.());assert.ok(disconnected>0)
  return values
}
for(const sensitivity of [2,20])assert.deepEqual(volumes(false,sensitivity),volumes(true,sensitivity))
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}
for(const volume of [0,.01,.119,.12,.16,.17,.34,.5,.84,1,-1,2]){
 const source=vm.runInNewContext(declaration('microphone','uo')+';uo({volume,fixedBarsCount:6,barWidth:6,barHeight:22,barGap:4,barBorderRadius:999})',{_0x22cc53:{useRef:()=>({current:null}),useState:v=>[v,()=>{}],useEffect(){}},_0x3f04aa:jsx,_0xe9e087:'div',volume})
 const app=project('src/renderer/hub/components/MicrophonePicker.tsx',{'./settingsText':{useSettingsText:()=>v=>v},'react/jsx-runtime':jsx,zod:require('zod')});app.run({});const result=app.exports.MicrophoneLevel({volume})
 const originalBars=source.props.children.flat().filter(Boolean),actual=result.props.children
 assert.equal(actual.length,6)
 assert.equal(actual.filter(b=>b.props.className==='is-active').length,originalBars.filter(b=>b.props.sx.backgroundColor==='accent.default').length)
 for(const bar of originalBars){assert.equal(bar.props.sx.width,6);assert.equal(bar.props.sx.height,22);assert.equal(bar.props.sx.borderRadius,'999px');assert.equal(bar.props.sx.transition,'background-color 0.15s ease-in-out')}
}
console.log('PASS source volume samples at sensitivities 2 and 20, meter thresholds, six fixed bars, and cleanup')
