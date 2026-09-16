const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { checkMetadata, checkLinks } = require('./check.cjs')

test('PR title and actual closing issue are required', () => {
  assert.doesNotThrow(() => checkMetadata('ci(repo): add checks', 1))
  assert.throws(() => checkMetadata('misc changes', 1), /title/)
  assert.throws(() => checkMetadata('ci(repo): add checks', 0), /Issue/)
})

test('relative links resolve from the document; remote links are not fetched', () => {
  const root = mkdtempSync(join(tmpdir(), 'room-check-'))
  try {
    writeFileSync(join(root, 'a b.md'), '# Target')
    const file = join(root, 'README.md')
    assert.deepEqual(checkLinks(file, '[ok](a%20b.md#target) [web](https://example.com) [anchor](#here)'), [])
    assert.deepEqual(checkLinks(file, '[bad](missing.md)'), ['missing.md'])
    assert.deepEqual(checkLinks(file, '[ref][target]\n\n[target]: missing.md'), ['missing.md'])
    assert.deepEqual(checkLinks(file, '```md\n[example](missing.md)\n```\n`[example](missing.md)`'), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
