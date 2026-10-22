import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PRODUCT } from '../../shared/constants'

const previous = app.getPath('userData')
app.setName(PRODUCT.displayName)

// Reuse an existing profile in place: saved audio paths and encrypted settings
// remain together. Explicit test/CLI profiles must also remain isolated.
const profileNames = ['sayrel', 'offkey']
if (profileNames.includes(basename(previous).toLowerCase())) {
  const root = app.getPath('appData')
  const current = join(root, PRODUCT.displayName)
  const candidates = [current, previous, ...['sayrel', 'offkey', 'Offkey', 'OffKey'].map(name => join(root, name))]
  const existing = candidates.find(directory => ['settings.json', 'sayrel.db', 'offkey.db'].some(file => existsSync(join(directory, file))))
  const directory = existing ?? current
  mkdirSync(directory, { recursive: true })
  app.setPath('userData', directory)
}
