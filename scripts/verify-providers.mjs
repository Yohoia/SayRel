import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(`${label} failed (${result.status ?? result.signal})`)
  }
  const passes = (result.stdout ?? '').split('\n').filter(line => /PASS|passed/.test(line))
  console.log(passes.length ? passes.join('\n') : `PASS ${label}`)
}
for (const name of ['providers-config', 'provider-runtime', 'realtime-providers']) run(process.execPath, ['--import', 'tsx', `scripts/diagnostics/${name}.ts`], name)
for (const [entry, name] of [['src/main/lib/settings.ts', 'settings'], ['src/main/ipc/providers.ts', 'ipc']]) {
  await build({ entryPoints: [resolve(root, entry)], outfile: resolve(root, `.build/provider-settings/${name}.mjs`), platform: 'node', format: 'esm', bundle: true, packages: 'external' })
}
const electron = resolve(root, 'node_modules/.bin/electron')
for (const name of ['provider-settings', 'providers-ipc']) run(electron, [`scripts/diagnostics/${name}.cjs`], name)
run(process.execPath, ['scripts/ui-build.mjs'], 'offline UI build')
run(electron, ['scripts/diagnostics/providers-ui.cjs'], 'provider UI')
