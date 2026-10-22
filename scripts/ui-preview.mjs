// Isolated UI review server. Fixtures are injected only by this script, never
// by the Electron development or production entry points.
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const server = await createServer({
  configFile: false,
  root: resolve(root, 'src/renderer'),
  plugins: [react(), {
    name: 'sayrel-ui-review-fixtures',
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: '/@fs/' + resolve(root, 'scripts/ui-fixture.ts') }, injectTo: 'head-prepend' }]
    }
  }],
  resolve: { alias: { '@shared': resolve(root, 'src/shared'), '@renderer': resolve(root, 'src/renderer') } },
  server: { host: '127.0.0.1', port: 4173, strictPort: true, fs: { allow: [root] } }
})
await server.listen()
console.log('UI review: http://127.0.0.1:4173/hub.html')
