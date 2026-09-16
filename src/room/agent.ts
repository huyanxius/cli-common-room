import type { Delivery, MemberId } from './context.js'

export interface TurnReference {
  readonly roomId: string
  readonly member: MemberId
  readonly turnId: string
}

// 工具日志属于执行事件，不属于可跨成员交付的 HistoryMessage。
export type AgentEvent = TurnReference & (
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'tool'; readonly toolId: string; readonly phase: 'started' | 'finished'; readonly text: string }
  | { readonly type: 'session'; readonly nativeSessionId: string }
  | { readonly type: 'finished'; readonly outcome: 'completed' | 'cancelled' | 'failed' | 'unknown' }
)

// 此接口只规定文本与轮次生命周期；审批/提问须在真实协议实验后扩展，不能降级成普通文本。
export interface AgentAdapter {
  start(delivery: Delivery, turnId: string): AsyncIterable<AgentEvent>
  cancel(turn: TurnReference): Promise<void>
  close(): Promise<void>
}

export type AgentSlot =
  | { readonly member: MemberId; readonly status: 'unavailable'; readonly reason: string }
  | { readonly member: MemberId; readonly status: 'ready'; readonly adapter: AgentAdapter }

export type AgentRegistry = Readonly<Record<MemberId, AgentSlot>>
