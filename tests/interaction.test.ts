import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerRequest } from '../src/adapters/codex/interaction.js'
import { safeText } from '../src/terminal/native-chat.js'

test('授权仅接受明确选项，保留原生规则内容且拒绝过期答案', async () => {
  const abort = new AbortController()
  assert.deepEqual(await answerRequest('item/fileChange/requestApproval', {}, abort.signal, async () => 'once'), { decision: 'accept' })
  await assert.rejects(answerRequest('item/fileChange/requestApproval', {}, abort.signal, async () => ''), /无效/)
  const rules = ['echo', 'test']
  assert.deepEqual(await answerRequest('item/commandExecution/requestApproval', { proposedExecpolicyAmendment: rules }, abort.signal, async p => {
    assert.equal(p.kind, 'approval')
    assert.match(p.details, /echo/)
    return 'policy'
  }), { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['echo', 'test'] } } })
  await assert.rejects(answerRequest('item/fileChange/requestApproval', {}, abort.signal, async () => { abort.abort(); return 'once' }), /过期/)
})

test('提问按问题 ID 返回答案，未知交互不能冒充已处理', async () => {
  const signal = new AbortController().signal
  assert.deepEqual(JSON.parse(JSON.stringify(await answerRequest('item/tool/requestUserInput', { questions: [{ id: 'q1', question: '选哪一个', isOther: false, options: [{ label: 'A', description: '方案 A' }] }] }, signal, async () => 'A'))), { answers: { q1: { answers: ['A'] } } })
  await assert.rejects(answerRequest('unknown/method', {}, signal, async () => 'once'), /尚未支持/)
})

test('模型和工具文本不能带终端控制序列，分段 ESC 也会移除', () => {
  assert.equal(safeText('\x1b[2J正文\x1b]52;c;secret\x07'), '正文')
  assert.equal(safeText('片段\x1b'), '片段')
  assert.equal(safeText('中文\n第二行\t内容'), '中文\n第二行\t内容')
})
