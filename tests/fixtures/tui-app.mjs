import { terminalWorkspace } from '../../dist/src/terminal/workspace.js'
import { CodexSession } from '../../dist/src/adapters/codex/session.js'
import { StdioRpc } from '../../dist/src/runtime/stdio-rpc.js'
import { fileURLToPath } from 'node:url'
const fixture=fileURLToPath(new URL('./chat-server.mjs',import.meta.url))
const factory=options=>new CodexSession(new StdioRpc(process.execPath,[fixture,'approval']),options)
await terminalWorkspace({codex:factory,claude:factory})
console.log('TUI_EXITED')
