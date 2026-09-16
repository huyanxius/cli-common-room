import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { StdioRpc } from '../src/runtime/stdio-rpc.js'
import { CodexSession, type SessionEvent } from '../src/adapters/codex/session.js'
const fixture = fileURLToPath(new URL('../../tests/fixtures/chat-server.mjs', import.meta.url))
function setup(mode = '', events: SessionEvent[] = [], interact?: ConstructorParameters<typeof CodexSession>[1]['interact']) {
  return new CodexSession(new StdioRpc(process.execPath, [fixture, mode]), {
    cwd: process.cwd(), turnTimeoutMs: 1000, onEvent: event => events.push(event), ...(interact ? { interact } : {}),
  })
}
test('同一原生线程连续两轮，缓冲提前事件并排除跨线程及旧轮次', async () => {
  const events: SessionEvent[] = []
  const session = setup('', events)
  try {
    assert.deepEqual(await session.initialize(), { threadId: 'thread-1', model: 'fixture-model' })
    assert.deepEqual(await session.run('第一轮'), { status: 'completed', text: '回答1' })
    assert.deepEqual(await session.run('第二轮'), { status: 'completed', text: '回答2' })
    assert.deepEqual(events.filter(e => e.type === 'text').map(e => e.text), ['回答1', '回答2'])
  } finally { await session.close() }
})
test('原生失败不能变成成功，断线结束等待', async () => {
  for (const mode of ['fail', 'crash']) {
    const session = setup(mode)
    try {
      await session.initialize()
      if (mode === 'fail') assert.equal((await session.run('test')).status, 'failed')
      else await assert.rejects(session.run('test'), /退出/)
    } finally { await session.close() }
  }
})
test('审批等待明确答案，拒绝选项原样回传', async () => {
  const session = setup('approval', [], async request => {
    assert.equal(request.kind, 'approval')
    assert.match(request.details, /echo test/)
    return 'decline'
  })
  try { await session.initialize(); assert.equal((await session.run('test')).status, 'completed') }
  finally { await session.close() }
})
test('忙碌时拒绝第二轮，取消必须收到原生 interrupted', async () => {
  const session = setup('hold')
  try {
    await session.initialize()
    const running = session.run('test')
    await assert.rejects(session.run('duplicate'), /忙碌/)
    await session.cancel()
    assert.equal((await running).status, 'cancelled')
  } finally { await session.close() }
})


test('轮次超时关闭连接，不把未完成内容当作成功或允许继续派发', async () => {
  const session = new CodexSession(new StdioRpc(process.execPath, [fixture, 'hold']), { cwd: process.cwd(), turnTimeoutMs: 50 })
  try {
    await session.initialize()
    await assert.rejects(session.run('test'), /超时/)
    await assert.rejects(session.run('retry'), /关闭/)
  } finally { await session.close() }
})
