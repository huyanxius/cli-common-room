import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRecipient } from '../src/terminal/queue.js'
import { validateSnapshot } from '../src/room/live.js'
import { createSetup, setupActions } from '../src/terminal/setup.js'
import { renderScreen } from '../src/terminal/screen.js'
import { emptyEditor } from '../src/terminal/editor.js'

test('agy 点名进入独立成员路由，不作为正文发送给当前成员', () => {
  assert.deepEqual(parseRecipient('@agy 读取项目', 'codex'), { recipient: 'agy', text: '读取项目' })
})
test('agy 的原生绑定与历史可以恢复，未知交付保护仍生效', () => {
  assert.doesNotThrow(() => validateSnapshot(JSON.parse(JSON.stringify({ version: 1,
    history: [{ roomId: 'current', sequence: 1, author: 'user', text: '你好' }, { roomId: 'current', sequence: 2, author: 'agy', text: '你好' }],
    bindings: [{ roomId: 'current', member: 'agy', nativeSessionId: 'native-id', deliveredThrough: 1 }], uncertain: ['agy'],
  }))))
})
test('配置页提供 agy 路径和进入入口', () => {
  assert.ok(setupActions(createSetup()).some(action => action.id === 'agy'))
})
test('AGY 头部和输入边框使用独立标识，正文不染色', () => {
  const frame = renderScreen({ member: 'AGY', telemetry: {}, cwd: '/tmp', git: '', status: 'Ready', messages: [{ role: 'AGY', text: '正文保持原色' }], editor: emptyEditor(), scroll: 0, menu: [], promptTitle: '', seconds: 0 }, 100, 30)
  assert.equal(frame.lines.find(line => line.text.includes('● AGY'))?.tone, 'agy')
  assert.equal(frame.lines.find(line => line.text.startsWith('╭'))?.tone, 'agy')
  assert.equal(frame.lines.find(line => line.text.includes('正文保持原色'))?.tone, 'bright')
})
