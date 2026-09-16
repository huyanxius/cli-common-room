import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MessageQueue, parseRecipient } from '../src/terminal/queue.js'
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
test('@只解析输入开头的成员标记，不误认邮箱与正文', () => {
  assert.deepEqual(parseRecipient('@claude hello', 'all'), { text: 'hello', recipient: 'claude' })
  assert.deepEqual(parseRecipient('@all', 'codex'), { text: '', recipient: 'all' })
  assert.deepEqual(parseRecipient('email a@claude.test', 'codex'), { text: 'email a@claude.test', recipient: 'codex' })
})
