const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { pathToFileURL } = require('node:url')
const { FileMatcher } = require('app-builder-lib/out/fileMatcher')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '../..')
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
  databaseModule = await import(pathToFileURL(entry).href)
  databaseModule.getDb()
  assert.ok(databaseModule.getRawDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history_v2'").get())
  assert.equal(databaseModule.getRawDb().prepare('SELECT COUNT(*) AS total FROM _migrations').get().total, migrations.length)
  databaseModule.closeDb()
  databaseModule.getDb()
  assert.equal(databaseModule.getRawDb().prepare('SELECT COUNT(*) AS total FROM _migrations').get().total, migrations.length)
  console.log('PASS packaged resource filters include SQL; bundled database starts and restarts without source files')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  databaseModule?.closeDb()
  fs.rmSync(temporary, { recursive: true, force: true })
})
