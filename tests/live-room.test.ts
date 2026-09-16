import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConversationRoom } from '../src/room/live.js'
import type { Conversation } from '../src/room/conversation.js'
test('双方接收同一快照，下一轮才收到另一成员回答', async () => {
  const delivered: Record<string, string[]> = { codex: [], claude: [] }
  const create = (member: string): Conversation => ({ initialize: async () => ({ threadId: member, model: member }), run: async text => { delivered[member]!.push(text); return { status: 'completed', text: `${member}答复` } }, cancel: async () => {}, close: async () => {} })
  const room = new ConversationRoom({ codex: () => create('codex'), claude: () => create('claude') }, () => ({ cwd: '/tmp' }))
  await room.send(['codex', 'claude'], '问题一')
  assert.equal(delivered.codex![0], delivered.claude![0])
  assert.ok(!delivered.claude![0]!.includes('codex答复'))
  await room.send(['claude'], '回应另一方')
  assert.match(delivered.claude![1]!, /codex答复/)
  assert.ok(!delivered.claude![1]!.includes('claude答复'))
  await room.close()
})
test('未知接收状态后不自动重发；新建成员会话才解除阻塞', async () => {
  let calls = 0
  const create = (): Conversation => ({ initialize: async () => ({ threadId: 't', model: 'm' }), run: async () => { calls++; throw new Error('lost') }, cancel: async () => {}, close: async () => {} })
  const room = new ConversationRoom({ codex: create, claude: create }, () => ({ cwd: '/tmp' }))
  await room.send(['codex'], 'test')
  await assert.rejects(room.send(['codex'], 'retry'), /未知/)
  assert.equal(calls, 1)
  await room.close()
})

test('取消房间后不启动排队的第二个成员，即使第一位恰好成功结束', async () => {
  let finish!: () => void
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  const second: string[] = []
  const first: Conversation = { initialize: async () => ({ threadId: 'a', model: 'm' }), run: async () => { started(); await new Promise<void>(resolve => { finish = resolve }); return { status: 'completed', text: 'done' } }, cancel: async () => { finish() }, close: async () => {} }
  const other: Conversation = { ...first, run: async text => { second.push(text); return { status: 'completed', text: 'bad' } } }
  const room = new ConversationRoom({ codex: () => first, claude: () => other }, () => ({ cwd: '/tmp' }))
  const running = room.send(['codex', 'claude'], 'test')
  await entered; await room.cancel(); await running
  assert.deepEqual(second, [])
  await room.close()
})
