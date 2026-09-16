import { createInterface } from 'node:readline'
const mode = process.argv[2]
let turn = 0
let active
const send = message => process.stdout.write(JSON.stringify(message) + '\n')
const event = (method, params) => send({ method, params })
const finish = (id, status = 'completed') => event('turn/completed', { threadId: 'thread-1', turn: { id, status } })
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') return send({ id: m.id, result: { userAgent: 'fixture' } })
  if (m.method === 'initialized') return
  if (m.method === 'thread/start') return send({ id: m.id, result: { thread: { id: 'thread-1' }, model: 'fixture-model' } })
  if (m.method === 'turn/interrupt') { send({ id: m.id, result: {} }); return finish(active, 'interrupted') }
  if (m.id === 'approval') {
    if (m.result?.decision !== 'decline') process.exit(12)
    return finish(active)
  }
  if (m.method === 'turn/start') {
    if (m.params.threadId !== 'thread-1') process.exit(11)
    active = `turn-${++turn}`
    if (mode === 'crash') { send({ id: m.id, result: { turn: { id: active } } }); process.exit(9) }
    if (mode === 'hold') return send({ id: m.id, result: { turn: { id: active } } })
    // 通知故意早于请求响应，并混入其它线程及旧轮次。
    event('item/agentMessage/delta', { threadId: 'other', turnId: active, itemId: 'bad', delta: '不应出现' })
    event('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'old', itemId: 'bad', delta: '旧消息' })
    event('item/agentMessage/delta', { threadId: 'thread-1', turnId: active, itemId: 'a', delta: `回答${turn}` })
    if (mode === 'approval') {
      send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: active, itemId: 'cmd', command: 'echo test' } })
    } else finish(active, mode === 'fail' ? 'failed' : 'completed')
    send({ id: m.id, result: { turn: { id: active } } })
  }
})
