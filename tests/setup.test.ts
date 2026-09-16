import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SetupPreferences } from '../src/storage/setup.js'
import { renderSetup, createSetup, setupActions } from '../src/terminal/setup.js'
import { width } from '../src/terminal/text.js'

test('引导偏好按原生配置隔离，保存后可恢复且不保存认证输出', async () => {
  const root = await mkdtemp(join(tmpdir(), 'room-setup-'))
  try {
    const store = new SetupPreferences(root, { CODEX_HOME: '/account/a' })
    assert.equal((await store.load()).completed, false)
    await store.save({ completed: true, selected: 'claude', binaries: { codex: 'codex', claude: '/a path/claude' } })
    assert.equal((await store.load()).binaries.claude, '/a path/claude')
    assert.equal((await new SetupPreferences(root, { CODEX_HOME: '/account/b' }).load()).completed, false)
    assert.equal((await stat(store.path)).mode & 0o777, 0o600)
    assert.deepEqual(Object.keys(JSON.parse(await readFile(store.path, 'utf8'))).sort(), ['binaries', 'completed', 'selected'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('配置页保留成员与可操作入口，窄窗口可导航到当前选项', () => {
  const state = createSetup()
  for (const [columns, rows] of [[100, 30], [40, 15], [20, 8]]) {
    state.index = setupActions(state).length - 1
    const frame = renderSetup(state, columns!, rows!, 0)
    assert.equal(frame.lines.length, rows)
    assert.ok(frame.lines.every(line => width(line.text) <= columns! - 1))
    assert.ok(frame.lines.some(line => line.text.includes('›')))
  }
  state.view = 'claude'
  assert.ok(setupActions(state).some(action => action.id === 'login'))
  state.input = 'secret-code'; state.editing = 'code'; state.pending = true
  const frame = renderSetup(state, 100, 30, 0)
  assert.ok(!frame.lines.some(line => line.text.includes('secret-code')))
})
