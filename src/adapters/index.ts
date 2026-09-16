import type { AgentRegistry } from '../room/agent.js'

// 安装了 CLI 不等于程序化接口已接通。只有真实接入完成后才能注册 ready 适配器。
export function nativeAgents(): AgentRegistry {
  return Object.freeze({
    claude: Object.freeze({ member: 'claude', status: 'unavailable', reason: 'Claude Code 流式接入尚未实现' }),
    codex: Object.freeze({ member: 'codex', status: 'unavailable', reason: '双成员群聊尚未接入；单成员会话使用 --codex-chat' }),
  })
}
