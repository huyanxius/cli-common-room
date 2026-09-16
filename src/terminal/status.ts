import type { AgentRegistry } from '../room/agent.js'

export function renderStatus(agents: AgentRegistry): string {
  const names = { claude: 'Claude Code', codex: 'Codex' }
  const lines = Object.values(agents).map(agent => agent.status === 'unavailable'
    ? `  ${names[agent.member]}：未接入 — ${agent.reason}`
    : `  ${names[agent.member]}：已接入`)
  return [
    'cli-common-room',
    '',
    ...lines,
    '',
    '当前仅可查看接入状态，尚不能发送群聊消息。',
    '使用 --help 查看命令。',
  ].join('\n')
}
