// Render extracted Typeless UI components with local React/MUI and the same fonts.
// Auth, native IPC, audio, account stores and network are replaced by inert fixtures.
import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import traversal from '@babel/traverse'
import { build } from 'esbuild'
const root=path.resolve(import.meta.dirname,'../../..'),out=path.join(root,'.build/typeless-floating')
function decl(file,names){const source=fs.readFileSync(path.join(out,file+'.js'),'utf8'),found=new Map();traversal.default(parse(source,{sourceType:'module'}),{VariableDeclarator(p){if(!p.getFunctionParent()&&names.includes(p.node.id.name))found.set(p.node.id.name,source.slice(p.node.init.start,p.node.init.end))}});return names.map(n=>`const ${n}=${found.get(n)};`).join('\n')}
const code=`import React from 'react';import {createRoot} from 'react-dom/client';import * as jsx from 'react/jsx-runtime';import {Box,Stack,Typography,Button,Tooltip,Popper,ThemeProvider,createTheme,CssBaseline} from '@mui/material';
const _0x4351da=React,_0x2f96ea=React,_0x4422f7=jsx,_0x2d10ab=jsx;
const _0xd7675=Box,_0xec1a23=Stack,_0x36ba9b=Typography,_0x5a0cf8=Button,_0x5980f5=Tooltip,_0x27e2af=Tooltip;
const _0x2353be=Box,_0x472f77=Stack,_0x17e1ba=Typography,_0x3ab581=Button,_0x14fca7=Popper;
const noop=()=>{},Yi=noop,Sa=noop,Aa=()=>null,Xr=()=>null,ji=()=>null,Ki=()=>null,_0x1f5207=()=>null,_0x18adbf=noop;
const _0x42dbef=()=>jsx.jsx('svg',{width:16,height:16}),_0x29e0ce=_0x42dbef,Es=()=>jsx.jsx('svg',{width:14,height:14});

const xt=fn=>fn({mode:'ask_anything'}),_0x12e985={VOICE_TRANSLATION:'translation',VOICE_COMMAND:'ask_anything'};
const _0x2b8ea2={settings:'settings'},Vn=code=>'language_selector__option__'+code.toLowerCase().replaceAll('-','_');
let settings={translationModeTargetLanguageCodes:['en','ja','zh-CN'],translationModeAlertPreferredLanguageCode:'en'};
let locale='zh-CN';
const dictionaries=${JSON.stringify(Object.fromEntries(['en','zh-CN'].map(locale=>[locale,JSON.parse(fs.readFileSync(path.join(root,'resources/locales',locale,'index.json'),'utf8')).client])))};
const t=key=>dictionaries[locale][key.replace(/^client:/,'')]??key;
const _0x451f42=()=>({t}),_0x2d19bb=()=>({t}),Xe=()=>({appSettings:settings,updateAppSetting:noop}),_0x3c0c98=()=>({appSettings:{}});
let state={voiceRecordingControlState:{status:'recording-dictating',sx:{width:82,height:34,padding:'4px',borderRadius:99,border:'1px solid #aaa',background:'#000',position:'relative'}},isRefining:true,dictationMode:'ask_anything'};
const ma=()=>({state,actions:{handleClickCancelButton:noop,handleClickFinishButton:noop}});
window.ipcRenderer={invoke:async()=>false};
${decl('floating',['je','gr','Ta','$i','Ia'])}
${decl('shared',['Kn','Is'])}
const root=createRoot(document.getElementById('root')),theme=createTheme({typography:{fontFamily:'SF Pro,MiSans,Arial,sans-serif',allVariants:{letterSpacing:'normal'}},components:{MuiButton:{styleOverrides:{root:{textTransform:'none'}}}}});
window.renderReference=(kind,code='en',language='zh-CN',targets=['en','ja','zh-CN'])=>{locale=language;settings={...settings,translationModeAlertPreferredLanguageCode:code,translationModeTargetLanguageCodes:targets};root.render(jsx.jsxs(ThemeProvider,{theme,children:[jsx.jsx(CssBaseline,{}),jsx.jsx('div',{id:'floating-bar',style:{position:'absolute',left:300,bottom:50},children:kind==='thinking'?jsx.jsx(Ia,{}):jsx.jsx(Is,{initialActiveLanguageCode:code},code+language+targets.join(','))})]}));};
window.renderReference('thinking');`
fs.writeFileSync(path.join(out,'reference-layout.jsx'),code)
await build({entryPoints:[path.join(out,'reference-layout.jsx')],bundle:true,outfile:path.join(out,'reference-layout.js'),format:'iife',logLevel:'error'})
fs.writeFileSync(path.join(out,'reference-layout.html'),`<style>@font-face{font-family:'SF Pro';src:url('../ui-review/fonts/ttf/Ci___yb_.ttf');font-weight:100 900}@font-face{font-family:MiSans;src:url('../ui-review/fonts/misans/MiSans-Regular.woff2');font-weight:400}</style><div id="root"></div><script src="reference-layout.js"></script>`)
