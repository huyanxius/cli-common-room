import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StdioRpc } from '../src/runtime/stdio-rpc.js'
import { fileURLToPath } from 'node:url'
const fixture = fileURLToPath(new URL('../../tests/fixtures/rpc-server.mjs', import.meta.url))
const connect = (timeoutMs = 1000) => new StdioRpc(process.execPath, [fixture], { timeoutMs })

test('双向协议按 ID 关联乱序响应，正确解析跨数据块的中文', async () => {
  const rpc = connect()
  try {
    const first = rpc.request('first', {})
    const second = rpc.request('second', {})
    assert.deepEqual(await Promise.all([first, second]), ['第一', '第二'])
  } finally { await rpc.close() }
})

test('未支持的原生审批返回错误，不自动批准或无限等待', async () => {
  const rpc = connect()
  try { assert.deepEqual(await rpc.request('approval', {}), { errorCode: -32601 }) }
  finally { await rpc.close() }
})

test('错误输出不泄露原生响应正文', async () => {
  const rpc = connect()
  try {
    await assert.rejects(rpc.request('error', {}), error => {
      assert.ok(error instanceof Error)
      assert.doesNotMatch(error.message, /private contents/)
      return /-1/.test(error.message)
    })
  } finally { await rpc.close() }
})

test('超时、异常退出和非法消息均结束等待，关闭后拒绝新请求', async () => {
  for (const method of ['hang', 'crash', 'malformed']) {
    const rpc = connect(method === 'hang' ? 150 : 1000)
    const expected = method === 'hang' ? /超时/ : method === 'crash' ? /退出/ : /无效/
    await assert.rejects(rpc.request(method, {}), expected)
    await rpc.close()
    await rpc.close()
    await assert.rejects(rpc.request('first', {}), /关闭|不可用/)
  }
})

test('关闭时拒绝未完成请求，缺失可执行文件也能正常清理', async () => {
  const rpc = connect()
  const pending = assert.rejects(rpc.request('hang', {}), /关闭/)
  await rpc.close()
  await pending
  const missing = new StdioRpc('/nonexistent/common-room-cli', [], { timeoutMs: 1000 })
  await assert.rejects(missing.request('initialize', {}), /启动/)
  await missing.close()
})


test('忽略温和终止的自有进程仍会被关闭，不遗留后台进程', { timeout: 3000 }, async () => {
  const rpc = new StdioRpc(process.execPath, [fixture, 'stubborn'])
  await rpc.request('initialize', {})
  await rpc.close()
  await assert.rejects(rpc.request('first', {}), /关闭/)
})

test('只读状态查询超时不关闭聊天连接，后续握手仍可完成', async () => {
  const rpc = new StdioRpc(process.execPath, [fixture], { timeoutMs: 100 })
  try {
    await assert.rejects(rpc.request('hang', {}, { readOnly: true }), /超时/)
    const result = await rpc.request('initialize', {})
    assert.equal((result as { userAgent: string }).userAgent, 'fixture/1')
  } finally { await rpc.close() }
})
