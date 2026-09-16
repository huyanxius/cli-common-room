import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
test('真实 PTY 中粘贴不执行命令，审批明确拒绝，退出恢复终端', () => {
  const script = fileURLToPath(new URL('../../tests/fixtures/tui-pty.py', import.meta.url))
  const app = fileURLToPath(new URL('../../tests/fixtures/tui-app.mjs', import.meta.url))
  const result = spawnSync('python3', [script, process.execPath, app], { encoding: 'utf8', timeout: 20_000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.match(result.stdout, /passed/)
})
