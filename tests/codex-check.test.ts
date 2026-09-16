import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StdioRpc } from '../src/runtime/stdio-rpc.js'
import { initializeCodex } from '../src/adapters/codex/check.js'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('../../tests/fixtures/rpc-server.mjs', import.meta.url))

test('握手只返回公开服务标识，不转发配置路径；不兼容响应必须失败', async () => {
  for (const mode of ['normal', 'bad-handshake']) {
    const rpc = new StdioRpc(process.execPath, [fixture, mode], { timeoutMs: 1000 })
    try {
      if (mode === 'normal') assert.deepEqual(await initializeCodex(rpc), { userAgent: 'fixture/1' })
      else await assert.rejects(initializeCodex(rpc), /握手/)
    } finally { await rpc.close() }
  }
})
