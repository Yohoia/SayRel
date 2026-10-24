const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '../../..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sayrel-identity-'))
function load(file, app) {
  const exports = {}
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = id => id === 'electron' ? { app } : id === '../../shared/constants' ? { PRODUCT: { displayName: 'Sayrel' } } : require(id)
  vm.runInNewContext(source, { exports, require: req, process }, { filename: file })
  return exports
}
function fixture(name, previous, files) {
  const appData = path.join(temporary, name)
  let userData = path.join(appData, previous), appName = 'sayrel'
  for (const [file, value] of Object.entries(files)) {
    const target = path.join(appData, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, value)
  }
  const app = { getPath: key => key === 'appData' ? appData : userData, setPath: (_, value) => { userData = value }, setName: name => { appName = name } }
  load('src/main/lib/appIdentity.ts', app)
  const { paths } = load('src/main/lib/paths.ts', app)
  assert.equal(appName, 'Sayrel')
  return { app, appData, userData, paths }
}
try {
  const fresh = fixture('fresh', 'sayrel', {})
  assert.equal(fresh.userData, path.join(fresh.appData, 'Sayrel'))
  assert.equal(fresh.paths.db, path.join(fresh.userData, 'sayrel.db'))
  assert.ok(fs.existsSync(fresh.userData))
  const old = fixture('legacy', 'sayrel', { 'offkey/settings.json': '{"deviceId":"saved-device"}', 'offkey/offkey.db': 'saved history', 'offkey/offkey.db-wal': 'uncheckpointed history', 'offkey/recordings/audio.ogg': 'saved audio' })
  assert.equal(old.userData, path.join(old.appData, 'offkey'))
  assert.equal(old.paths.db, path.join(old.userData, 'offkey.db'))
  assert.equal(fs.readFileSync(old.paths.db + '-wal', 'utf8'), 'uncheckpointed history')
  assert.equal(fs.readFileSync(path.join(old.paths.recordings, 'audio.ogg'), 'utf8'), 'saved audio')
  assert.equal(JSON.parse(fs.readFileSync(path.join(old.userData, 'settings.json'), 'utf8')).deviceId, 'saved-device')
  load('src/main/lib/appIdentity.ts', old.app)
  assert.equal(old.app.getPath('userData'), old.userData, 'restart keeps using the existing profile')
  const current = fixture('current', 'sayrel', { 'Sayrel/sayrel.db': 'new history', 'offkey/offkey.db': 'old history' })
  assert.equal(current.paths.db, path.join(current.appData, 'Sayrel/sayrel.db'))
  const isolated = fixture('isolated', 'custom-review-profile', { 'offkey/settings.json': '{}' })
  assert.equal(isolated.userData, path.join(isolated.appData, 'custom-review-profile'))
  console.log('PASS Sayrel identity: fresh installs, legacy settings/history/WAL/audio, restart, current-profile precedence, and isolated profiles')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
