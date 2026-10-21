import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const r = (p: string) => resolve(__dirname, p)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: r('src/main/index.ts'),
          'worker/opusWorker': r('src/main/workers/opusWorker.ts'),
          'worker/chunkSessionWorker': r('src/main/workers/chunkSessionWorker.ts')
        },
        output: {
          format: 'es',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: r('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: r('src/renderer'),
    publicDir: r('public'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': r('src/shared'),
        '@renderer': r('src/renderer')
      }
    },
    build: {
      outDir: r('out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          hub: r('src/renderer/hub.html'),
          'floating-bar': r('src/renderer/floating-bar.html'),
          onboarding: r('src/renderer/onboarding.html'),
          sidebar: r('src/renderer/sidebar.html'),
          'interactive-card': r('src/renderer/interactive-card.html')
        }
      }
    }
  }
})
