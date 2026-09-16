import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectNative, loginNative } from '../src/runtime/native-auth.js'

const executable = fileURLToPath(new URL('../../tests/fixtures/auth-cli.mjs', import.meta.url))
test('原生登录在同一进程收验证码，认证结果重新检测且不返回账号隐私', async () => {
  const root = await mkdtemp(join(tmpdir(), 'room-auth-'))
  const env = { ...process.env, ROOM_TEST_AUTH_STATE: join(root, 'native') }
  try {
    assert.equal((await inspectNative('claude', executable, { env })).auth, 'signed-out')
    let output = ''
    const login = loginNative('claude', executable, { env, onOutput: text => { output = text; if (text.includes('https:')) login.send('valid-code') } })
    await login.done
    const status = await inspectNative('claude', executable, { env })
    assert.equal(status.auth, 'signed-in')
    assert.ok(!JSON.stringify(status).includes('private@example.test'))
    assert.match(output, /Login successful/)
    assert.equal(await readFile(join(root, 'native'), 'utf8'), 'native-owned')
    assert.equal((await inspectNative('codex', executable, { env })).auth, 'signed-in')
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('缺失程序、登录失败与取消都不冒充成功', async () => {
  assert.equal((await inspectNative('claude', '/missing/room-cli')).installed, false)
  await assert.rejects(loginNative('claude', executable, { env: { ...process.env, ROOM_TEST_AUTH_FAIL: '1' }, onOutput: () => {} }).done, /失败/)
  const login = loginNative('codex', executable, { onOutput: () => {} })
  const done = assert.rejects(login.done, /取消/)
  login.cancel()
  await done
})
