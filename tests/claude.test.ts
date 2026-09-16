import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerToolPermission } from '../src/adapters/claude/interaction.js'

test('Claude 工具授权只接受明确选择，取消后不允许迟到批准', async () => {
  const abort = new AbortController()
  const denied = await answerToolPermission('Bash', { command: 'echo test' }, { signal: abort.signal }, async () => 'deny')
  assert.equal(denied.behavior, 'deny')
  await assert.rejects(answerToolPermission('Bash', {}, { signal: abort.signal }, async () => { abort.abort(); return 'allow' }), /过期/)
})
test('Claude 提问逐题映射回答，不当作普通工具批准', async () => {
  const result = await answerToolPermission('AskUserQuestion', { questions: [{ question: '选择方向', header: '方向', options: [{ label: 'A', description: '第一种' }], multiSelect: false }] }, { signal: new AbortController().signal }, async prompt => {
    assert.equal(prompt.kind, 'question')
    return 'A'
  })
  assert.equal(result.behavior, 'allow')
  if (result.behavior === 'allow') assert.deepEqual(result.updatedInput?.answers, { '选择方向': 'A' })
})
