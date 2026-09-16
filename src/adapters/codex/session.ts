import { codexCommands } from './commands.js'
import { StdioRpc, type RpcOptions } from '../../runtime/stdio-rpc.js'
import { initializeCodex } from './check.js'

import type { SessionOptions, TurnResult } from '../../room/conversation.js'
import { readUsage, readQuotas } from './telemetry.js'
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
  private compacting = false
  private mode: 'plan' | 'default' | undefined
  private serviceTier: string | undefined
  private permissionOverride: Record<string, unknown> = {}
  private currentModel = ''
  private skillNames = new Set<string>()
  private modelOverride: string | undefined
  private effortOverride: string | undefined
  private readonly timeoutMs: number

  constructor(private readonly rpc: StdioRpc, private readonly options: SessionOptions) {
    this.timeoutMs = options.turnTimeoutMs ?? 600_000
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('轮次超时必须是正整数')
    rpc.onNotification((method, params) => {
      if (method === 'thread/tokenUsage/updated' && params && typeof params === 'object') {
        const data = record(params)
        const usage = readUsage(data.tokenUsage)
        if (data.threadId === this.threadId && usage) this.options.onTelemetry?.({ usage })
        return
      }
      if (method === 'account/rateLimits/updated') {
        const quotas = readQuotas(params)
        if (quotas.length) this.options.onTelemetry?.({ quotas })
        return
      }
      const active = this.active
      if (!active || active.done) return
      if (!active.id) {
        if (active.buffer.length >= 1000) { active.fail(new Error('轮次开始前的事件过多')); void this.close(); return }
        active.buffer.push([method, params])
      } else this.receive(active, method, params)
    })
    rpc.onClose(error => { this.closed = true; this.active?.fail(error); this.options.onDisconnect?.(error) })
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
      const result = record(await this.rpc.request(this.options.resumeThreadId ? 'thread/resume' : 'thread/start', this.options.resumeThreadId ? { threadId: this.options.resumeThreadId } : { cwd: this.options.cwd }))
      this.threadId = idOf(record(result.thread).id)
      this.currentModel = idOf(result.model)
      this.options.onCommands?.(codexCommands)
      this.options.onTelemetry?.({ threadId: this.threadId, model: idOf(result.model), provider: String(result.modelProvider ?? '未知'), effort: String(result.reasoningEffort ?? '默认'), approval: typeof result.approvalPolicy === 'string' ? result.approvalPolicy : JSON.stringify(result.approvalPolicy ?? '未知'), sandbox: result.sandbox ? String(record(result.sandbox).type) : '未知' })
      return { threadId: this.threadId, model: idOf(result.model) }
    } catch (error) { await this.close(); throw error }
    finally { this.initializing = false }
  }

  async run(text: string, review = false): Promise<TurnResult> {
    if (this.closed || !this.threadId) throw new Error('会话尚未连接或已关闭')
    if (this.active || this.compacting) throw new Error('成员忙碌，请等待或停止当前轮次')
    if (!text.trim()) throw new Error('消息不能为空')
    let resolve!: (value: TurnResult) => void
    let reject!: (error: Error) => void
    const completed = new Promise<TurnResult>((yes, no) => { resolve = yes; reject = no })
    void completed.catch(() => {})
    const ready = this.rpc.request(review ? 'review/start' : 'turn/start', review ? { threadId: this.threadId, target: text === 'uncommitted' ? { type: 'uncommittedChanges' } : { type: 'custom', instructions: text }, delivery: 'inline' } : {
      threadId: this.threadId, ...this.permissionOverride, ...(this.serviceTier ? { serviceTier: this.serviceTier } : {}), ...(this.mode ? { collaborationMode: { mode: this.mode, settings: { model: this.modelOverride ?? this.currentModel, reasoning_effort: this.effortOverride ?? null, developer_instructions: null } } } : {}), ...(this.modelOverride ? { model: this.modelOverride } : {}), ...(this.effortOverride ? { effort: this.effortOverride } : {}), input: [{ type: 'text', text, text_elements: [] }],
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

  async command(name: string, argument: string): Promise<string> {
    if (this.closed || !this.threadId) throw new Error('会话尚未连接或已关闭')
    if (this.active || this.compacting) throw new Error('请等待当前轮次结束')
    if (name === 'model') {
      const response = record(await this.rpc.request('model/list', {}))
      const models = Array.isArray(response.data) ? response.data.map(record) : []
      if (!argument) return models.map(model => `${model.model} · ${model.displayName ?? ''}`).join('\n') + '\n/model <名称> 切换下一轮模型'
      if (!models.some(model => model.model === argument)) throw new Error('模型不在原生可用列表中')
      this.modelOverride = argument
      this.effortOverride = undefined
      this.options.onTelemetry?.({ model: argument })
      return `下一轮使用 ${argument}`
    }
    if (name === 'effort') {
      const response = record(await this.rpc.request('model/list', {}))
      const models = Array.isArray(response.data) ? response.data.map(record) : []
      const model = models.find(model => model.model === (this.modelOverride ?? this.currentModel)) ?? models.find(model => model.isDefault)
      const efforts = model && Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts.map(record).map(value => String(value.reasoningEffort)) : []
      if (!argument) return `可用推理强度：${efforts.join(', ') || '未提供'}`
      if (!efforts.includes(argument)) throw new Error('原生模型未报告支持此推理强度')
      this.effortOverride = argument
      this.options.onTelemetry?.({ effort: argument })
      return `下一轮推理强度：${argument}`
    }
    if (name === 'usage') {
      try {
        const quotas = readQuotas(await this.rpc.request('account/rateLimits/read', {}, { readOnly: true }))
        this.options.onTelemetry?.({ quotas, quotaError: quotas.length ? '' : '原生未提供订阅额度' })
        return quotas.length ? '订阅额度已更新' : '原生未提供订阅额度；可能使用 API 或当前 provider 不支持'
      } catch (error) { this.options.onTelemetry?.({ quotaError: '订阅额度读取失败' }); throw error }
    }
    if (name === 'skills') {
      const response = record(await this.rpc.request('skills/list', { cwds: [this.options.cwd] }))
      const entries = Array.isArray(response.data) ? response.data.map(record) : []
      const skills = entries.flatMap(entry => Array.isArray(entry.skills) ? entry.skills.map(record) : [])
      this.skillNames = new Set(skills.filter(skill => skill.enabled !== false).map(skill => String(skill.name)))
      this.options.onCommands?.([...codexCommands, ...skills.filter(skill => skill.enabled !== false).map(skill => ({ name: String(skill.name), description: String(skill.description ?? '') }))])
      return skills.map(skill => `$${skill.name} · ${skill.description ?? ''}`).join('\n') || '原生未报告 skills'
    }
    if (name === 'mcp') {
      const response = record(await this.rpc.request('mcpServerStatus/list', {}))
      return (Array.isArray(response.data) ? response.data.map(record).map(server => `${server.name} · ${server.authStatus ?? '未知'} · ${Object.keys(record(server.tools ?? {})).length} tools`).join('\n') : '') || '原生未报告 MCP 服务'
    }
    if (name === 'rename') {
      if (!argument) throw new Error('用法：/rename 名称')
      await this.rpc.request('thread/name/set', { threadId: this.threadId, name: argument })
      return `线程已命名：${argument}`
    }
    if (name === 'review') {
      const result = await this.run(argument || 'uncommitted', true)
      if (result.status !== 'completed') throw new Error(`审查${result.status === 'cancelled' ? '已停止' : '失败'}`)
      return '审查完成'
    }
    if (name === 'plan') {
      if (!['on', 'off'].includes(argument)) return '用法：/plan on 或 /plan off'
      this.mode = argument === 'on' ? 'plan' : 'default'
      return `下一轮模式：${this.mode}`
    }
    if (name === 'fast') {
      const response = record(await this.rpc.request('model/list', {}, { readOnly: true }))
      const models = Array.isArray(response.data) ? response.data.map(record) : []
      const model = models.find(model => model.model === (this.modelOverride ?? this.currentModel))
      const tiers = model && Array.isArray(model.serviceTiers) ? model.serviceTiers.map(record).map(tier => String(tier.id)) : []
      if (!argument) return `原生可用服务档位：${tiers.join(', ') || '未提供'}；/fast <档位>`
      if (!tiers.includes(argument)) throw new Error('当前模型未报告此档位')
      this.serviceTier = argument
      return `下一轮服务档位：${argument}`
    }
    if (name === 'permissions' || name === 'approvals') {
      if (!argument) return '权限沿用原生配置。/permissions read-only|workspace-write|full-access 可修改本会话；修改前会显示确认。'
      const presets: Record<string, Record<string, unknown>> = {
        'read-only': { approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } },
        'workspace-write': { approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [this.options.cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } },
        'full-access': { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } },
      }
      const preset = presets[argument]
      if (!preset || !this.options.interact) throw new Error('请选择有效权限模式')
      const lifetime = new AbortController()
      const off = this.rpc.onClose(() => lifetime.abort())
      try {
        const answer = await this.options.interact({ kind: 'approval', title: '更改当前成员权限', details: `${argument}\n${JSON.stringify(preset, null, 2)}`, signal: lifetime.signal, choices: [{ id: 'change', label: '确认更改' }, { id: 'cancel', label: '保持现有权限' }] })
        if (lifetime.signal.aborted) throw new Error('交互已过期')
        if (answer !== 'change') return '权限未更改'
        this.permissionOverride = preset
        this.options.onTelemetry?.({ approval: String(preset.approvalPolicy), sandbox: String(record(preset.sandboxPolicy).type) })
        return '权限将在下一轮生效'
      } finally { off() }
    }
    if (name === 'apps' || name === 'hooks') {
      const response = record(await this.rpc.request(name === 'apps' ? 'app/list' : 'hooks/list', name === 'apps' ? {} : { cwds: [this.options.cwd] }, { readOnly: true }))
      return JSON.stringify(response, null, 2)
    }
    if (name === 'compact') {
      this.compacting = true
      let off = () => {}, close = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = new Promise<void>((resolve, reject) => {
        off = this.rpc.onNotification((method, value) => {
          if (!value || typeof value !== 'object') return
          const params = record(value)
          if (params.threadId !== this.threadId) return
          if (method === 'thread/compacted' || (method === 'item/completed' && record(params.item).type === 'contextCompaction')) resolve()
        })
        close = this.rpc.onClose(reject)
        timer = setTimeout(() => { reject(new Error('压缩超时，结果未知')); void this.close() }, this.timeoutMs)
      })
      void done.catch(() => {})
      try { await this.rpc.request('thread/compact/start', { threadId: this.threadId }); await done; return '原生上下文压缩完成' }
      finally { off(); close(); clearTimeout(timer); this.compacting = false }
    }
    if (this.skillNames.has(name)) {
      const result = await this.run(`$${name}${argument ? ' ' + argument : ''}`)
      if (result.status !== 'completed') throw new Error('Skill 未完成')
      return 'Skill 执行完成'
    }
    throw new Error('当前成员未提供此命令；输入 / 查看可用命令')
  }

  async cancel(): Promise<void> {
    if (this.compacting) { await this.close(); return }
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
