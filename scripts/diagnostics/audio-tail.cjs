// Diagnostic only: fake microphone, no real tracks or user settings are accessed.
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
const chunks=[];let processor,trackStopped=false,closed=false;
class FakeContext {
 sampleRate=48000;
 audioWorklet={addModule:async()=>{throw new Error('fallback')}};
 createMediaStreamSource(){return {connect(){},disconnect(){}}}
 createAnalyser(){return {fftSize:2048,getByteTimeDomainData:(a)=>a.fill(128)}}
 createScriptProcessor(){return processor={connect(){},disconnect(){}}}
 async close(){closed=true}
}
const exportsObj={};
const source=fs.readFileSync(path.resolve(__dirname,'../../src/renderer/floating-bar/audio.ts'),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObj,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){trackStopped=true}}]})}},AudioContext:FakeContext,requestAnimationFrame:()=>1,cancelAnimationFrame(){},Float32Array,Uint8Array});
(async()=>{const handle=await exportsObj.startRecorder({onChunk:c=>chunks.push(c),onLevel(){}});processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(2048).fill(0.25)}});await handle.stop();const count=chunks.reduce((s,c)=>s+c.length,0);console.log(`${count===682?'PASS':'FAIL'} stop flushes final 682 PCM samples: received ${count}; trackStopped=${trackStopped}; closed=${closed}`);process.exitCode=count===682?0:1;})()
