const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { pathToFileURL } = require('node:url')
const { FileMatcher } = require('app-builder-lib/out/fileMatcher')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '../../..')
fs.mkdirSync(path.join(root, '.build'), { recursive: true })
const temporary = fs.mkdtempSync(path.join(root, '.build/packaged-db-'))
const resources = path.join(temporary, 'Resources'), database = path.join(temporary, 'test.db')
let databaseModule
async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build
  const matchers = config.extraResources.map(rule => new FileMatcher(path.join(root, rule.from), path.join(resources, rule.to), value => value, rule.filter))
  const migrations = fs.readdirSync(path.join(root, 'resources/db')).filter(file => file.endsWith('.sql'))
  for (const name of migrations) {
    const source = path.join(root, 'resources/db', name)
    const matcher = matchers.find(rule => source.startsWith(rule.from + path.sep) && rule.createFilter()(source, fs.statSync(source)))
    assert.ok(matcher, name + ' must be included by the real packaging configuration')
    const destination = path.join(matcher.to, path.relative(matcher.from, source))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
  }
  const entry = path.join(resources, 'app/out/main/database.mjs')
  await build({ entryPoints: [path.join(root, 'src/main/db/index.ts')], outfile: entry, platform: 'node', format: 'esm', bundle: true, packages: 'external', define: { 'process.resourcesPath': JSON.stringify(resources) }, plugins: [{
    name: 'isolated-user-data', setup(build) {
      build.onResolve({ filter: /^\.\.\/lib\/(paths|logger)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('/paths')
        ? `export const paths = { db: ${JSON.stringify(database)} }`
        : 'export const createLogger = () => ({ info() {}, warn() {}, error() {} })' }))
    }
  }] })
  const Database = require('better-sqlite3')
  const legacy = new Database(database)
  legacy.exec('CREATE TABLE _migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)')
  for (const name of migrations.filter(name => name < '0003').sort()) {
    legacy.exec(fs.readFileSync(path.join(root,'resources/db',name),'utf8'))
    legacy.prepare('INSERT INTO _migrations VALUES (?,?)').run(name,new Date().toISOString())
  }
  legacy.prepare("INSERT INTO history_v2 (id,user_id,refined_text,mode_meta,audio_local_path) VALUES (?,?,?,?,?)").run('saved-history','retired-user','Keep this text',Buffer.from('{"kind":"empty"}'),'/saved/audio.ogg')
  legacy.prepare("INSERT INTO dictionary (id,user_id,word,created_at,updated_at) VALUES (?,?,?,?,?)").run('saved-word','retired-user','Sayrel','2026-10-21','2026-10-21')
  legacy.close()
  databaseModule = await import(pathToFileURL(entry).href)
  databaseModule.getDb()
  assert.ok(databaseModule.getRawDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history_v2'").get())
  assert.equal(databaseModule.getRawDb().prepare('SELECT COUNT(*) AS total FROM _migrations').get().total, migrations.length)
  const sql = databaseModule.getRawDb()
  const saved = sql.prepare("SELECT * FROM history_v2 WHERE id='saved-history'").get()
  assert.equal(saved.refined_text,'Keep this text')
  assert.equal(saved.audio_local_path,'/saved/audio.ogg')
  assert.equal(saved.mode_meta.toString(),'{"kind":"empty"}')
  assert.equal(sql.prepare("SELECT word FROM dictionary WHERE id='saved-word'").get().word,'Sayrel')
  for (const table of ['history_v2','dictionary']) assert.ok(!sql.prepare('PRAGMA table_info('+table+')').all().some(column=>/^(user_id|sync_status|synced_from_cloud|sync_attempt_count|server_updated_at)$/.test(column.name)))
  databaseModule.closeDb()
  databaseModule.getDb()
  assert.equal(databaseModule.getRawDb().prepare('SELECT COUNT(*) AS total FROM _migrations').get().total, migrations.length)
  console.log('PASS packaged migrations preserve saved history/audio/metadata/dictionary, remove account/sync columns, and restart without source files')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  databaseModule?.closeDb()
  fs.rmSync(temporary, { recursive: true, force: true })
})
