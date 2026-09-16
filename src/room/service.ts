import { planDeliveries, type HistoryMessage, type MemberId, type MemberSession, type Delivery } from './context.js'
import type { AgentRegistry } from './agent.js'

export interface RoomState {
  readonly roomId: string
  readonly history: readonly HistoryMessage[]
  readonly sessions: readonly MemberSession[]
}

export class RoomService {
  constructor(private readonly agents: AgentRegistry) {}

  // 只准备上下文，不调用原生进程、不推进交付游标；双方都可用才允许进入后续执行。
  prepare(state: RoomState, recipients: readonly MemberId[]): readonly Delivery[] {
    const deliveries = planDeliveries(state.roomId, state.history, state.sessions, recipients)
    for (const delivery of deliveries) {
      const agent = this.agents[delivery.member]
      if (agent.member !== delivery.member) throw new Error('成员与适配器身份不一致')
      if (agent.status === 'unavailable') throw new Error(`${delivery.member} 不可用：${agent.reason}`)
    }
    return deliveries
  }
}
