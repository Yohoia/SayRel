// Compile the real private helpers into a test executable; use a named pasteboard only.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
if (process.platform !== 'darwin') {
  console.log('SKIP clipboard ownership: macOS AppKit required')
} else {
  const root = path.resolve(__dirname, '../../..')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sayrel-clipboard-test-'))
  try {
    const source = fs.readFileSync(path.join(root, 'swift/InputHelper.swift'), 'utf8') + `
let testBoard = NSPasteboard(name: NSPasteboard.Name("sayrel-test-" + UUID().uuidString))
defer { testBoard.releaseGlobally() }
let first = NSPasteboardItem()
first.setString("first", forType: .string)
first.setString("<b>first</b>", forType: .html)
let second = NSPasteboardItem()
second.setString("second", forType: .string)
testBoard.clearContents()
testBoard.writeObjects([first, second])
private let archived = savePasteboard(testBoard)
testBoard.clearContents()
testBoard.setString("temporary payload", forType: .string)
let owned = testBoard.changeCount
restorePasteboard(testBoard, from: archived, ifUnchangedSince: owned)
assert(testBoard.pasteboardItems?.count == 2, "restore every original item, not a flattened item")
assert(testBoard.pasteboardItems?[0].string(forType: .html) == "<b>first</b>")
assert(testBoard.pasteboardItems?[1].string(forType: .string) == "second")
testBoard.clearContents()
testBoard.setString("temporary payload", forType: .string)
let previousOwner = testBoard.changeCount
testBoard.clearContents()
testBoard.setString("new copy from another process", forType: .string)
restorePasteboard(testBoard, from: archived, ifUnchangedSince: previousOwner)
assert(testBoard.string(forType: .string) == "new copy from another process", "never overwrite a newer clipboard owner")
print("PASS native clipboard: item/type preservation and changeCount ownership on an isolated named pasteboard")
`
    const file = path.join(temporary, 'clipboard-test.swift'), executable = path.join(temporary, 'clipboard-test')
    fs.writeFileSync(file, source)
    const built = spawnSync('swiftc', [file, '-o', executable, '-framework', 'Cocoa', '-framework', 'Carbon'], { encoding: 'utf8' })
    if (built.status !== 0) throw new Error(built.stderr || 'Swift compiler failed')
    const tested = spawnSync(executable, [], { encoding: 'utf8' })
    process.stdout.write(tested.stdout)
    if (tested.status !== 0) throw new Error(tested.stderr || 'Clipboard assertions failed')
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
}
