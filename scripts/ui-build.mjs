// Offline review build. Never included in production; no server or network port.
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
await build({
  configFile: false,
  root: resolve(root, 'src/renderer'),
  publicDir: resolve(root, 'public'),
  base: './',
  plugins: [react(), {
    name: 'sayrel-offline-review',
    transformIndexHtml: { order: 'pre', handler() {
      return [{ tag: 'script', attrs: { type: 'module', src: '/@fs/' + resolve(root, 'scripts/ui-fixture.ts') }, injectTo: 'head-prepend' }]
    } }
  }],
  build: { outDir: resolve(root, '.build/ui-review'), emptyOutDir: true, rollupOptions: { input: Object.fromEntries(['hub', 'floating-bar', 'interactive-card', 'onboarding', 'sidebar'].map(name => [name, resolve(root, 'src/renderer', `${name}.html`)])) } }
})
