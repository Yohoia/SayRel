// Replay only the reference dialog and meter JSX with inert device/audio boundaries.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import traversal from '@babel/traverse'
import { build } from 'esbuild'
const root=path.resolve(import.meta.dirname,'../..'),output=path.join(root,'.build/typeless-floating')
const source=fs.readFileSync(path.join(output,'microphone.js'),'utf8'),found=new Map()
traversal.default(parse(source,{sourceType:'module'}),{VariableDeclarator(p){if(!p.getFunctionParent()&&['dn','uo','da'].includes(p.node.id.name))found.set(p.node.id.name,source.slice(p.node.init.start,p.node.init.end))}})
for(const name of ['dn','uo','da'])if(!found.has(name))throw new Error('Missing original component: '+name)
const dictionaries=Object.fromEntries(['en','zh-CN'].map(locale=>[locale,JSON.parse(fs.readFileSync(path.join(root,'resources/locales',locale,'index.json'),'utf8')).client]))
const code=`import React from 'react';import {createRoot}from'react-dom/client';import * as jsx from'react/jsx-runtime';import {Box,Stack,Typography,Button,Modal,Fade,Paper,IconButton,ThemeProvider,createTheme,CssBaseline}from'@mui/material';
const _0x22cc53=React,_0x3f04aa=jsx,_0xe9e087=Box,_0x550ecc=Stack,_0x30b01a=Typography,_0x4dce63=Button,_0x3af168=Modal,_0x225683=Fade,_0x2f4591=Paper,_0x50a77a=IconButton;
let fixture={volume:1,selected:'default',locale:'zh-CN',devices:[]};const dictionaries=${JSON.stringify(dictionaries)},noop=()=>{};
const t=key=>dictionaries[fixture.locale][key.replace(/^client:/,'')]??key;
const _0x552e58=()=>({t}),_0x2e8e26=()=>({updateAppSetting:noop}),_0x1d23ad=()=>fixture.volume;
const _0x873857={USES_SYSTEM_DEFAULT:'default',RECOMMENDED:'recommended',BLUETOOTH:'bluetooth',EXTERNAL:'external'};
const ho=()=>({devices:fixture.devices,refreshDevices:noop,isEmptyDevices:fixture.devices.length===0,currentSelectedDevice:fixture.devices.find(d=>d.deviceId===fixture.selected)||fixture.devices[0],getDeviceDisplayName:d=>d.label,builtInDevice:fixture.devices.find(d=>d.description==='recommended'),effectiveDeviceId:fixture.selected,isLidOpen:false});
class _0x289e9f{state={mediaStream:null};subscribe(){}startRecording(){}stopRecording(){}cleanup(){}}
const _0x54207e=props=>jsx.jsx('svg',{...props,width:14,height:14,viewBox:'0 0 24 24',children:jsx.jsx('path',{d:'M18 6 6 18M6 6l12 12',stroke:'currentColor',strokeWidth:2})});const co=()=>null,lo=Button;
${['dn','uo','da'].map(name=>'const '+name+'='+found.get(name)+';').join('\n')}
const root=createRoot(document.getElementById('root'));const theme=createTheme({palette:{background:{topLayer:'#fff'},text:{tertiary:'#777'},accent:{default:'#0000c2'},border:{thin:{default:'#e5e5e5'},thick:{default:'#d7d7d7',focusTough:'#0000c2',hover:'#777'}},fill:{none:{selected:'#f0f0fc',hover:'#f4f4f4'},action:{default:'#d7d7d7'}}},typography:{fontFamily:'SF Pro,MiSans,Arial,sans-serif',allVariants:{letterSpacing:'normal'}}});
window.renderMicrophoneReference=value=>{fixture={...fixture,...value};root.render(jsx.jsxs(ThemeProvider,{theme,children:[jsx.jsx(CssBaseline,{}),jsx.jsx(da,{show:true,onClose:noop},fixture.locale+fixture.selected+fixture.devices.length)]}));};
window.renderMicrophoneReference({});`
fs.writeFileSync(path.join(output,'microphone-reference.jsx'),code)
await build({entryPoints:[path.join(output,'microphone-reference.jsx')],bundle:true,outfile:path.join(output,'microphone-reference.js'),format:'iife',logLevel:'error'})
fs.writeFileSync(path.join(output,'microphone-reference.html'),`<style>@font-face{font-family:'SF Pro';src:url('../ui-review/fonts/ttf/Ci___yb_.ttf');font-weight:100 900}@font-face{font-family:MiSans;src:url('../ui-review/fonts/misans/MiSans-Regular.woff2');font-weight:400}</style><div id="root"></div><script src="microphone-reference.js"></script>`)
console.log('Prepared original microphone dialog, source SHA-256 '+createHash('sha256').update(source).digest('hex'))
