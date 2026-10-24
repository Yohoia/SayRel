import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
function run(command, args, label, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(`${label} failed (${result.status ?? result.signal})`)
  }
  const passes = (result.stdout ?? '').split('\n').filter(line => /PASS|passed/.test(line))
  console.log(passes.length ? passes.join('\n') : `PASS ${label}`)
}
for (const [group, name] of [['providers', 'providers-config'], ['providers', 'provider-runtime'], ['providers', 'realtime-providers'], ['refinement', 'refinement-integrity'], ['refinement', 'transcription-integrity'], ['refinement', 'refinement-quality']]) run(process.execPath, ['--import', 'tsx', `scripts/diagnostics/${group}/${name}.ts`], name)
for (const [entry, name] of [['src/main/lib/settings.ts', 'settings'], ['src/main/ipc/providers.ts', 'ipc']]) {
  await build({ entryPoints: [resolve(root, entry)], outfile: resolve(root, `.build/provider-settings/${name}.mjs`), platform: 'node', format: 'esm', bundle: true, packages: 'external' })
}
run(process.execPath, ['scripts/diagnostics/settings/settings-recovery.cjs'], 'settings-recovery')
const electron = resolve(root, 'node_modules/.bin/electron')
run(electron, ['scripts/diagnostics/audio/voice-recovery.cjs'], 'voice-recovery', { ...process.env, ELECTRON_RUN_AS_NODE: '1' })
for (const name of ['provider-settings', 'providers-ipc']) run(electron, [`scripts/diagnostics/providers/${name}.cjs`], name)
run(process.execPath, ['scripts/ui-build.mjs'], 'offline UI build')
run(electron, ['scripts/diagnostics/providers/providers-ui.cjs'], 'provider UI')
run(electron, ['scripts/diagnostics/settings/recovery-ui.cjs'], 'recovery UI')
