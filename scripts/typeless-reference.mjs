// Read-only artifact inspection. Only the string-table decoder runs in an empty VM;
// application bootstrap, imports, native libraries and network code never execute.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import generator from '@babel/generator'
import traversal from '@babel/traverse'
import * as t from '@babel/types'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, '.build/typeless-floating')
fs.mkdirSync(output, { recursive: true })
const files = {
  floating: 'dist/renderer/static/js/DFvLNtQv.mjs',
  shared: 'dist/renderer/static/js/DWYvEY4x.js',
  card: 'dist/renderer/static/js/DTGF8R6e.mjs',
  'card-component': 'dist/renderer/static/js/BYNd6ENk.js',
  main: 'dist/main/index.js'
}
const manifest = {}
for (const [name, relative] of Object.entries(files)) {
  const file = path.join(root, 'reference/typeless-asar', relative)
  const source = fs.readFileSync(file, 'utf8')
  const ast = parse(source, { sourceType: 'module' })
  let decodedCalls = 0
  if (name === 'main') {
    const decoderNames = new Set(['_0x4963', '_0x167c'])
    const declarations = ast.program.body.filter(node => t.isFunctionDeclaration(node) && decoderNames.has(node.id.name))
    if (declarations.length !== 2) throw new Error('Reference decoder changed')
    const rotation = ast.program.body[1]
    if (!t.isExpressionStatement(rotation) || !t.isCallExpression(rotation.expression) || !t.isFunctionExpression(rotation.expression.callee)) throw new Error('Reference rotation changed')
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings:false, wasm:false } })
    vm.runInContext(declarations.map(node => source.slice(node.start, node.end)).join('\n') + '\n' + source.slice(rotation.start, rotation.end), context, { timeout:1000 })
    traversal.default(ast, { CallExpression(nodePath) {
      const { node } = nodePath
      if (!t.isIdentifier(node.callee) || node.arguments.length !== 1 || !t.isNumericLiteral(node.arguments[0])) return
      let name = node.callee.name, scope = nodePath.scope
      const visited = new Set()
      while (name !== '_0x4963' && !visited.has(name)) {
        visited.add(name)
        const binding = scope.getBinding(name)
        if (!binding?.constant || !binding.path.isVariableDeclarator() || !t.isIdentifier(binding.path.node.init)) return
        name = binding.path.node.init.name
        scope = binding.path.scope
      }
      if (name !== '_0x4963') return
      const value = vm.runInContext(`_0x4963(${node.arguments[0].value})`, context, { timeout:100 })
      if (typeof value !== 'string') throw new Error('Decoder returned a non-string')
      nodePath.replaceWith(t.stringLiteral(value)); decodedCalls++
    } })
  }
  traversal.default(ast, { enter(nodePath) { delete nodePath.node.extra } })
  fs.writeFileSync(path.join(output, name + '.js'), generator.default(ast, { compact:false, comments:false }).code)
  manifest[name] = { path:relative, sha256:createHash('sha256').update(source).digest('hex'), decodedCalls }
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log('Prepared read-only Typeless references in ' + output)
