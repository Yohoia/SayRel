import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = resolve(process.argv[2] ?? join(homedir(), 'Desktop/Sayrel-logo'))
const sourceManifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
const copies = [
  ['application-icons/mac/icon.icns', 'resources/build/icon.icns'],
  ['application-icons/mac/Sayrel.iconset/icon_512x512@2x.png', 'resources/build/mac-icon.png'],
  ['application-icons/win/icon.ico', 'resources/build/icon.ico'],
  ['application-icons/png/1024x1024.png', 'resources/build/icon.png'],
  ...['tray.png', 'tray@2x.png', 'tray-win32.png', 'tray-win32@2x.png'].map(name => [`tray/${name}`, `resources/build/${name}`]),
  ['tray/tray-blue-32.png', 'resources/build/tray-linux.png'],
  ...['sayrel-horizontal.svg', 'sayrel-wordmark.svg', 'sayrel-symbol.svg', 'sayrel-app-icon.svg'].map(name => [`logos/${name}`, `public/assets/brand/${name}`]),
  ...['favicon.svg', 'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png'].map(name => [`favicon/${name}`, `public/${name}`])
]

// Validate the complete input before changing any installed assets.
const assets = copies.map(([from, to]) => {
  const data = readFileSync(join(source, from))
  const sha256 = createHash('sha256').update(data).digest('hex')
  const original = sourceManifest.find(asset => asset.path === from)
  if (!original || original.sha256 !== sha256 || original.bytes !== data.length) throw new Error(`Source manifest mismatch: ${from}`)
  return { path: to, source: from, bytes: data.length, sha256, ...(original.size ? { pixels: original.size } : {}) }
})
for (const asset of assets) {
  const destination = join(root, asset.path)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(join(source, asset.source), destination)
}
// The app canvas includes generous margins. Give the UI symbol a tighter
// viewport so its visible mark matches the 26px wordmark at a 32px CSS size.
const symbol = readFileSync(join(source, 'logos/sayrel-symbol.svg'), 'utf8')
const uiSymbol = symbol.replace('viewBox="0 0 1024 1024"', 'viewBox="165 170 702 702"')
const uiPath = 'public/assets/brand/sayrel-ui-symbol.svg'
writeFileSync(join(root, uiPath), uiSymbol)
assets.push({ path: uiPath, source: 'logos/sayrel-symbol.svg', transform: { viewBox: [165, 170, 702, 702] }, bytes: Buffer.byteLength(uiSymbol), sha256: createHash('sha256').update(uiSymbol).digest('hex') })
writeFileSync(join(root, 'public/assets/brand/manifest.json'), JSON.stringify({ source: 'User-provided Sayrel-logo / Fixed V2', assets }, null, 2) + '\n')
console.log(`Installed ${assets.length} verified Sayrel brand assets`)
