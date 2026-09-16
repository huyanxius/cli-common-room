import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MessageQueue, parseRecipient, recipients } from '../src/terminal/queue.js'
test('排队消息冻结接收者，暂停后不会被自动取出，撤回返回原消息', () => {
  const queue = new MessageQueue()
  queue.add('first', 'claude'); queue.add('second', 'all')
  queue.pause()
  assert.equal(queue.take(), undefined)
  assert.deepEqual(queue.withdraw(), { text: 'second', recipient: 'all' })
  queue.resume()
  assert.deepEqual(queue.take(), { text: 'first', recipient: 'claude' })
  assert.equal(queue.take(), undefined)
})
test('多成员队列复制接收者列表，all 展开全部可用成员', () => {
  const queue = new MessageQueue(), members: ('agy' | 'codex')[] = ['agy', 'codex']
  queue.add('固定目标', members); members.pop()
  assert.deepEqual(queue.take()?.recipient, ['agy', 'codex'])
  assert.deepEqual(recipients('all'), ['codex', 'claude', 'agy'])
})
test('@只解析输入开头的成员标记，不误认邮箱与正文', () => {
  assert.deepEqual(parseRecipient('@claude hello', 'all'), { text: 'hello', recipient: 'claude' })
  assert.deepEqual(parseRecipient('@all', 'codex'), { text: '', recipient: 'all' })
  assert.deepEqual(parseRecipient('email a@claude.test', 'codex'), { text: 'email a@claude.test', recipient: 'codex' })
})
test('多个点名按出现顺序去重，正文中的独立点名也能派发', () => {
  assert.deepEqual(parseRecipient('@agy @codex @agy 一起看', 'claude'), { text: '一起看', recipient: ['agy', 'codex'] })
  assert.deepEqual(parseRecipient('请看这里 @claude 和 @agy', 'codex'), { text: '请看这里  和', recipient: ['claude', 'agy'] })
  assert.deepEqual(parseRecipient('@agy @all 看看', 'codex'), { text: '看看', recipient: ['agy', 'codex', 'claude'] })
  assert.deepEqual(parseRecipient('代码 `@agy` 邮箱 x@codex.test', 'claude'), { text: '代码 `@agy` 邮箱 x@codex.test', recipient: 'claude' })
})
