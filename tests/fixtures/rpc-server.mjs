import { createInterface } from 'node:readline'
const mode = process.argv[2]
if (mode === 'stubborn') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000) }
let first
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (message.method === 'hang') return
  if (message.method === 'crash') process.exit(7)
  if (message.method === 'malformed') { process.stdout.write('not-json\n'); return }
  if (message.method === 'error') { process.stdout.write(JSON.stringify({ id: message.id, error: { code: -1, message: 'private contents must not escape' } }) + '\n'); return }
  if (message.method === 'approval') {
    first = message.id
    process.stdout.write(JSON.stringify({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: {} }) + '\n')
    return
  }
  if (message.id === 'approval-1') {
    process.stdout.write(JSON.stringify({ id: first, result: { errorCode: message.error?.code } }) + '\n')
    return
  }
  if (message.method === 'initialize') {
    if (mode === 'bad-handshake') {
      process.stdout.write(JSON.stringify({ id: message.id, result: { unexpected: true } }) + '\n')
    } else {
      process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: 'fixture/1', codexHome: '/private/hidden', platformOs: 'test' } }) + '\n')
    }
    return
  }
  if (message.method === 'initialized') return
  if (message.method === 'first') { first = message; return }
  if (message.method === 'second') {
    const output = JSON.stringify({ id: message.id, result: '第二' }) + '\n' + JSON.stringify({ id: first.id, result: '第一' }) + '\n'
    const bytes = Buffer.from(output)
    const split = bytes.indexOf(Buffer.from('第')) + 1
    process.stdout.write(bytes.subarray(0, split))
    setTimeout(() => process.stdout.write(bytes.subarray(split)), 10)
    return
  }
})
