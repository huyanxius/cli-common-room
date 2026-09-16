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


test('连接检查的启动失败返回非零退出码且不报告成功', () => {
  const failed = spawnSync(process.execPath, [entry.pathname, '--check-codex', '--codex-bin', '/nonexistent/common-room-cli'], { encoding: 'utf8' })
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /启动失败/)
  assert.doesNotMatch(failed.stdout, /成功/)
})


test('非交互输入不能进入需要人工授权的聊天入口', () => {
  const result = spawnSync(process.execPath, [entry.pathname, '--codex-chat'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /交互终端/)
})
