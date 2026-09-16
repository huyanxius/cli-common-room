import { terminalWorkspace } from '../../dist/src/terminal/workspace.js'
import { appendFileSync } from 'node:fs'
const factory = member => options => ({
  initialize: async () => ({ threadId: member, model: 'fixture' }),
  command: async (name, argument) => { if (name === 'probe') appendFileSync(process.env.ROOM_TEST_TRACE, JSON.stringify({ member, command: name, argument }) + '\n'); return 'COMMAND_OK' },
  run: async text => {
    appendFileSync(process.env.ROOM_TEST_TRACE, JSON.stringify({ member, text }) + '\n')
    options.onEvent?.({ type: 'text', text: `ANSWER_${member}` })
    return { status: 'completed', text: `ANSWER_${member}` }
  }, cancel: async () => {}, close: async () => {},
})
await terminalWorkspace({ codex: factory('codex'), claude: factory('claude'), agy: factory('agy') })
console.log('TUI_EXITED')
