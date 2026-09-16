import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
test('PTY 多次 @ 补全保留草稿，多成员共享快照且 all 派发三位', () => {
  const result = spawnSync('python3', ['tests/fixtures/multi-mention.py', process.execPath, 'tests/fixtures/multi-mention.mjs'], { encoding: 'utf8', timeout: 20_000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.match(result.stdout, /passed/)
})
