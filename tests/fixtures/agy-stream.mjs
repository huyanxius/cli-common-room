import { createInterface } from 'node:readline'
import assert from 'node:assert/strict'
const args = process.argv.slice(2)
if (args.some(arg => arg.startsWith('--print=/'))) {
  const name = args.find(arg => arg.startsWith('--print=/')).slice(9)
  process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: 'native report', command: { name, data: { id: 'fixture-model', effort: 'high' } } }))
  process.exit(0)
}
assert.ok(args.includes('--input-format'))
assert.ok(args.includes('--print='))
assert.ok(!args.includes('--dangerously-skip-permissions'))
const resume = args.indexOf('--conversation')
const id = resume < 0 ? 'agy-thread' : args[resume + 1]
const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
emit({ event: 'init', conversation_id: process.env.AGY_CASE === 'wrong-resume' ? 'other' : id, init: { cwd: process.cwd(), tools: ['view_file'], permission_mode: 'request-review' } })
let turn = 0
createInterface({ input: process.stdin }).on('line', line => {
  const value = JSON.parse(line)
  assert.equal(value.event, 'user')
  assert.equal(typeof value.message.content, 'string')
  turn++
  if (value.message.content === 'hang') return
  if (value.message.content === 'disconnect') { process.exit(1) }
  if (value.message.content === 'timeout') process.stderr.write('[agy] print timeout after 1s with turn in progress; returning partial output\n')
  if (value.message.content === 'control') { emit({ event: 'permission_request', id: 'p' }); return }
  emit({ event: 'step_update', step_update: { conversation_id: id, step_index: turn, state: 'RUNNING', step_type: 'tool', tool_info: { name: 'view_file', parameters: { path: 'sample.txt' } } } })
  emit({ event: 'step_update', step_update: { conversation_id: id, step_index: turn, state: 'DONE', step_type: 'tool', tool_info: { name: 'view_file', output: 'fixture' } } })
  emit({ event: 'step_update', step_update: { conversation_id: id, step_index: turn + 10, state: 'DONE', step_type: 'model_response', text_delta: `回复${turn}` } })
  emit({ event: 'result', result: { conversation_id: id, status: 'SUCCESS', response: `回复${turn}`, num_turns: turn, usage: { input_tokens: 10, output_tokens: 2, thinking_tokens: 1, cache_read_tokens: 3, total_tokens: 13 }, ...(value.message.content === 'deny' ? { denied_actions: ['run_command'] } : {}) } })
})
