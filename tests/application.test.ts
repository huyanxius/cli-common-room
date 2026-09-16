import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApplication } from '../src/app.js'
import { RoomService, type RoomState } from '../src/room/service.js'
import type { AgentAdapter } from '../src/room/agent.js'

const room: RoomState = {
  roomId: 'r1',
  history: [{ roomId: 'r1', sequence: 1, author: 'user', text: '你好' }],
  sessions: [
    { roomId: 'r1', member: 'claude', nativeSessionId: null, deliveredThrough: 0 },
    { roomId: 'r1', member: 'codex', nativeSessionId: null, deliveredThrough: 0 },
  ],
}
// 若 prepare 提前调用任何执行方法，此测试替身立即失败；产品入口不使用它。
const notStarted: AgentAdapter = {
  start() { throw new Error('prepare 不得启动模型') },
  async cancel() { throw new Error('prepare 不得取消轮次') },
  async close() { throw new Error('prepare 不得关闭连接') },
}

test('默认应用明确拒绝未接入成员，不创建会话或推进游标', () => {
  const app = createApplication()
  for (const member of ['claude', 'codex'] as const) {
    assert.equal(app.agents[member].status, 'unavailable')
    assert.throws(() => app.room.prepare(room, [member]), /不可用/)
  }
  assert.deepEqual(room.sessions.map(s => s.deliveredThrough), [0, 0])
})

test('只检查被点名成员；同时询问任一不可用时整体拒绝，避免隐式少发', () => {
  const app = createApplication()
  const service = new RoomService({ ...app.agents, codex: { member: 'codex', status: 'ready', adapter: notStarted } })
  const prepared = service.prepare(room, ['codex'])
  assert.deepEqual(prepared[0]?.messages, room.history)
  assert.throws(() => service.prepare(room, ['codex', 'claude']), /不可用/)
})

test('适配器成员绑定错误不能把上下文交给另一位', () => {
  const app = createApplication()
  const service = new RoomService({ ...app.agents, codex: { member: 'claude', status: 'ready', adapter: notStarted } })
  assert.throws(() => service.prepare(room, ['codex']), /身份/)
})
