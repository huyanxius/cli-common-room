import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import type { Conversation, SessionOptions, SessionEvent } from '../src/room/conversation.js'
const modulePath = '../src/adapters/agy/session.js'
const fixture = resolve('tests/fixtures/agy-stream.mjs')
async function session(options: Partial<SessionOptions> = {}): Promise<Conversation> {
  const { openAgySession } = await import(modulePath)
  return openAgySession({ cwd: process.cwd(), turnTimeoutMs: 2000, ...options }, process.execPath, [fixture])
}
test('原生事件映射文本工具用量，两轮保持同一会话', async () => {
  const events: SessionEvent[] = [], metrics: unknown[] = []
  const s = await session({ onEvent: e => events.push(e), onTelemetry: t => metrics.push(t) })
  try {
    assert.equal((await s.initialize()).threadId, 'agy-thread')
    assert.deepEqual(await s.run('one'), { status: 'completed', text: '回复1' })
    assert.deepEqual(await s.run('two'), { status: 'completed', text: '回复2' })
    assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), '回复1回复2')
    assert.equal(events.find(e => e.tool?.status === 'completed')?.tool?.output, 'fixture')
    assert.ok(metrics.some(t => (t as { usage?: { total: number } }).usage?.total === 13))
  } finally { await s.close() }
})
test('恢复必须返回请求的原生 ID，不能静默绑定新会话', async () => {
  const s = await session({ resumeThreadId: 'saved' })
  try { assert.equal((await s.initialize()).threadId, 'saved') } finally { await s.close() }
  const wrong = await session({ resumeThreadId: 'saved', env: { ...process.env, AGY_CASE: 'wrong-resume' } })
  try { await assert.rejects(wrong.initialize(), /恢复/) } finally { await wrong.close() }
})
for (const input of ['timeout', 'disconnect', 'control']) test(`${input} 不得作为成功交付`, async () => {
  const s = await session()
  try { await s.initialize(); await assert.rejects(s.run(input)) } finally { await s.close() }
})
test('原生工具拒绝不冒充完整成功，不自动授权重试', async () => {
  const s = await session()
  try { await s.initialize(); assert.equal((await s.run('deny')).status, 'failed') } finally { await s.close() }
})
test('停止关闭自有进程，未收到原生停止确认时结果未知', async () => {
  const s = await session()
  try {
    await s.initialize()
    const running = s.run('hang')
    const rejected = assert.rejects(running, /未知|关闭|停止/)
    await new Promise(resolve => setImmediate(resolve))
    await s.cancel(); await rejected
  } finally { await s.close() }
})
test('只读命令返回原生报告，修改类参数不得变成模型提示词', async () => {
  const s = await session()
  try {
    await s.initialize()
    assert.equal(await s.command!('model', ''), 'native report')
    await assert.rejects(s.command!('model', 'other'))
    await assert.rejects(s.command!('unknown', ''))
    assert.equal((await s.run('one')).text, '回复1')
  } finally { await s.close() }
})
