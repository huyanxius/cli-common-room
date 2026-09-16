import { StdioRpc, type RpcOptions } from '../../runtime/stdio-rpc.js'
import { initializeCodex } from './check.js'

import type { SessionOptions, TurnResult } from '../../room/conversation.js'
import { answerRequest } from './interaction.js'
export type { SessionOptions, SessionEvent } from '../../room/conversation.js'

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('原生协议字段不兼容')
  return value as Record<string, unknown>
}
const idOf = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('原生协议缺少标识')
  return value
}
interface ActiveTurn {
  id: string | null
  ready: Promise<string>
  buffer: Array<[string, unknown]>
  parts: Map<string, string>
  abort: AbortController
  done: boolean
  complete(result: TurnResult): void
  fail(error: Error): void
}

export class CodexSession {
  private threadId: string | null = null
  private active: ActiveTurn | null = null
  private closed = false
  private initializing = false
  private readonly timeoutMs: number

  constructor(private readonly rpc: StdioRpc, private readonly options: SessionOptions) {
    this.timeoutMs = options.turnTimeoutMs ?? 600_000
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('轮次超时必须是正整数')
    rpc.onNotification((method, params) => {
      const active = this.active
      if (!active || active.done) return
      if (!active.id) {
        if (active.buffer.length >= 1000) { active.fail(new Error('轮次开始前的事件过多')); void this.close(); return }
        active.buffer.push([method, params])
      } else this.receive(active, method, params)
    })
    rpc.onClose(error => { this.closed = true; this.active?.fail(error) })
    rpc.onRequest(async (method, value, signal) => {
      const active = this.active
      if (!active || active.done) throw new Error('无活动轮次')
      const params = record(value)
      const turnId = await active.ready
      if (params.threadId !== this.threadId || params.turnId !== turnId || active !== this.active || active.done) throw new Error('过期交互')
      try {
        if (!this.options.interact) throw new Error('当前入口不支持原生交互')
        const response = await answerRequest(method, params, AbortSignal.any([signal, active.abort.signal]), this.options.interact)
        if (active !== this.active || active.done || active.abort.signal.aborted) throw new Error('过期交互')
        return response
      } catch {
        if (!active.done) {
          active.fail(new Error('原生交互未完成，轮次已停止；不会自动批准'))
          void this.close()
        }
        throw new Error('交互失败')
      }
    })
  }

  async initialize(): Promise<{ threadId: string; model: string }> {
    if (this.closed || this.threadId || this.initializing) throw new Error('会话不能重复初始化')
    this.initializing = true
    try {
      await initializeCodex(this.rpc)
      // 沿用原生模型、权限和工具配置，不通过覆盖参数规避接入问题。
      const result = record(await this.rpc.request('thread/start', { cwd: this.options.cwd }))
      this.threadId = idOf(record(result.thread).id)
      return { threadId: this.threadId, model: idOf(result.model) }
    } catch (error) { await this.close(); throw error }
    finally { this.initializing = false }
  }

  async run(text: string): Promise<TurnResult> {
    if (this.closed || !this.threadId) throw new Error('会话尚未连接或已关闭')
    if (this.active) throw new Error('成员忙碌，请等待或停止当前轮次')
    if (!text.trim()) throw new Error('消息不能为空')
    let resolve!: (value: TurnResult) => void
    let reject!: (error: Error) => void
    const completed = new Promise<TurnResult>((yes, no) => { resolve = yes; reject = no })
    void completed.catch(() => {})
    const ready = this.rpc.request('turn/start', {
      threadId: this.threadId, input: [{ type: 'text', text, text_elements: [] }],
    }).then(result => idOf(record(record(result).turn).id))
    const active: ActiveTurn = {
      id: null, ready, buffer: [], parts: new Map(), abort: new AbortController(), done: false,
      complete(result) { if (!active.done) { active.done = true; active.abort.abort(); resolve(result) } },
      fail(error) { if (!active.done) { active.done = true; active.abort.abort(); reject(error) } },
    }
    this.active = active
    const timer = setTimeout(() => {
      active.fail(new Error('轮次超时，执行结果未知；连接已关闭，不自动重试'))
      void this.close()
    }, this.timeoutMs)
    try {
      active.id = await ready
      for (const [method, params] of active.buffer) this.receive(active, method, params)
      active.buffer = []
      return await completed
    } catch (error) { await this.close(); throw error }
    finally { clearTimeout(timer); active.abort.abort(); this.active = null }
  }

  async cancel(): Promise<void> {
    const active = this.active
    if (!active || active.done) return
    const turnId = await active.ready
    if (active.done || this.active !== active) return
    await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId })
    // interrupt 响应只表示收到请求；最终状态仍以 turn/completed 为准。
  }

  async close(): Promise<void> { this.closed = true; await this.rpc.close() }

  private receive(active: ActiveTurn, method: string, value: unknown): void {
    if (active.done || !['item/agentMessage/delta', 'item/started', 'item/completed', 'turn/completed'].includes(method)) return
    try {
      const params = record(value)
      if (params.threadId !== this.threadId) return
      const turn = method === 'turn/completed' ? record(params.turn) : null
      if ((turn?.id ?? params.turnId) !== active.id) return
      if (method === 'item/agentMessage/delta') {
        const itemId = idOf(params.itemId)
        if (typeof params.delta !== 'string') throw new Error('文本事件不兼容')
        active.parts.set(itemId, (active.parts.get(itemId) ?? '') + params.delta)
        this.options.onEvent?.({ type: 'text', text: params.delta })
      } else if (method === 'item/started' || method === 'item/completed') {
        const item = record(params.item)
        if (item.type === 'agentMessage' && method === 'item/completed' && typeof item.text === 'string') {
          const itemId = idOf(item.id)
          if (!active.parts.has(itemId)) this.options.onEvent?.({ type: 'text', text: item.text })
          active.parts.set(itemId, item.text)
        } else if (!['agentMessage', 'userMessage', 'reasoning', 'hookPrompt'].includes(String(item.type))) {
          this.options.onEvent?.({ type: 'tool', text: `${method === 'item/started' ? '开始' : '结束'} ${JSON.stringify(item)}` })
        }
      } else if (turn) {
        const status = turn.status === 'completed' ? 'completed' : turn.status === 'interrupted' ? 'cancelled' : turn.status === 'failed' ? 'failed' : null
        if (!status) throw new Error('未知轮次结束状态')
        active.complete({ status, text: [...active.parts.values()].join('\n') })
      }
    } catch {
      active.fail(new Error('原生轮次事件不兼容，执行结果未知'))
      void this.close()
    }
  }
}

export function openCodexSession(options: SessionOptions, command = 'codex', runtime: RpcOptions = {}): CodexSession {
  return new CodexSession(new StdioRpc(command, ['app-server', '--listen', 'stdio://'], runtime), options)
}
