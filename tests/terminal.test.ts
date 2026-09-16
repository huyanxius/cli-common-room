import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const entry = new URL('../src/main.js', import.meta.url)

test('终端入口报告不可用状态，帮助可读；未知命令不冒充成功', () => {
  const status = spawnSync(process.execPath, [entry.pathname], { encoding: 'utf8' })
  assert.equal(status.status, 0)
  assert.match(status.stdout, /Claude Code.*未接入/)
  assert.match(status.stdout, /Codex.*未接入/)
  const help = spawnSync(process.execPath, [entry.pathname, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /--status/)
  const invalid = spawnSync(process.execPath, [entry.pathname, 'chat'], { encoding: 'utf8' })
  assert.equal(invalid.status, 2)
  assert.match(invalid.stderr, /不支持/)
})
