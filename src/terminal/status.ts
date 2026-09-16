import type { AgentRegistry } from '../room/agent.js'

export function renderStatus(agents: AgentRegistry): string {
  const names = { claude: 'Claude Code', codex: 'Codex', agy: 'AGY' }
  const lines = Object.values(agents).map(agent => agent.status === 'unavailable'
    ? `  ${names[agent.member]}：未接入 — ${agent.reason}`
    : `  ${names[agent.member]}：已接入`)
  return [
    'cli-common-room',
    '',
    ...lines,
    '',
    '使用 --codex-chat 进入 Codex 单成员会话；完整群聊尚未接入。',
    '使用 --help 查看命令。',
  ].join('\n')
}
