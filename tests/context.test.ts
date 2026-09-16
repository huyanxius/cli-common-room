import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planDeliveries, type HistoryMessage, type MemberSession } from '../src/room/context.js'

const history: HistoryMessage[] = [
  { roomId: 'r1', sequence: 1, author: 'user', text: '比较两种方案' },
  { roomId: 'r1', sequence: 2, author: 'claude', text: '选 A：维护成本更低' },
  { roomId: 'r1', sequence: 3, author: 'codex', text: '选 B：扩展更直接' },
  { roomId: 'r1', sequence: 4, author: 'user', text: '请回应维护成本的问题，@claude 只是正文' },
]
const sessions: MemberSession[] = [
  { roomId: 'r1', member: 'claude', nativeSessionId: 'c1', deliveredThrough: 1 },
  { roomId: 'r1', member: 'codex', nativeSessionId: 'x1', deliveredThrough: 1 },
]

test('点名只派给指定成员，保留其他成员原话，排除自己的回复', () => {
  const plans = planDeliveries('r1', history, sessions, ['codex'])
  assert.equal(plans.length, 1)
  assert.equal(plans[0]?.member, 'codex')
  assert.equal(plans[0]?.nativeSessionId, 'x1')
  assert.deepEqual(plans[0]?.messages, [history[1], history[3]])
  assert.equal(sessions[1]?.deliveredThrough, 1)
})

test('双方共用同一历史截止点，调用者后续修改不能污染已准备的上下文', () => {
  const input = history.map(message => ({ ...message }))
  const plans = planDeliveries('r1', input, sessions, ['claude', 'codex'])
  input[0]!.text = '后来被编辑的文本'
  input[3]!.text = '后来追加的问题'
  input.push({ roomId: 'r1', sequence: 5, author: 'claude', text: '本轮先完成的答案' })
  assert.deepEqual(plans.map(p => p.throughSequence), [4, 4])
  assert.deepEqual(plans[0]?.messages.map(m => m.author), ['codex', 'user'])
  assert.equal(plans[1]?.messages[1]?.text, history[3]?.text)
  assert.ok(Object.isFrozen(plans[0]?.messages[0]))
})

test('无接收者、重复接收者和未知成员均不能派发', () => {
  assert.throws(() => planDeliveries('r1', history, sessions, []), /接收者/)
  assert.throws(() => planDeliveries('r1', history, sessions, ['codex', 'codex']), /接收者/)
  assert.throws(() => planDeliveries('r1', history, sessions, ['other' as 'codex']), /接收者/)
})

test('拒绝跨群历史、跨群会话、重复成员及非法交付游标', () => {
  assert.throws(() => planDeliveries('r2', history, sessions, ['codex']), /群/)
  assert.throws(() => planDeliveries('r1', history, [{ ...sessions[1]!, roomId: 'r2' }], ['codex']), /群/)
  assert.throws(() => planDeliveries('r1', history, [sessions[1]!, sessions[1]!], ['codex']), /重复/)
  for (const deliveredThrough of [-1, 0.5, 5, NaN]) {
    assert.throws(() => planDeliveries('r1', history, [{ ...sessions[1]!, deliveredThrough }], ['codex']), /游标/)
  }
})

test('拒绝乱序或重复历史；新会话从零接收，恢复必须显式指定原生会话', () => {
  assert.throws(() => planDeliveries('r1', [history[1]!, history[0]!], sessions, ['codex']), /顺序/)
  assert.throws(() => planDeliveries('r1', [history[0]!, history[0]!], sessions, ['codex']), /顺序/)
  assert.throws(() => planDeliveries('r1', history, [], ['codex']), /会话/)
  assert.throws(() => planDeliveries('r1', history, [{ ...sessions[1]!, nativeSessionId: null }], ['codex']), /新会话/)
  assert.throws(() => planDeliveries('r1', history, [{ ...sessions[1]!, nativeSessionId: null, deliveredThrough: 0 }], ['codex']), /新会话/)
  const plans = planDeliveries('r1', history.slice(0, 2), [{ ...sessions[1]!, nativeSessionId: null, deliveredThrough: 0 }], ['codex'])
  assert.deepEqual(plans[0]?.messages.map(m => m.sequence), [1, 2])
})
