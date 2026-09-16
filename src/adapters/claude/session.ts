import { query, type Query, type SDKUserMessage, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type { Conversation, SessionOptions, TurnResult, NativeCommand } from '../../room/conversation.js'
import { readClaudeQuotas } from './usage.js'
import { answerToolPermission } from './interaction.js'

export class ClaudeSession implements Conversation {
  private connection: Query | undefined
  private threadId = randomUUID() as string
  private model = '原生默认（首轮确认）'
  private effort: string | undefined
  private closed = false
  private cancelling = false
  private wake: ((value: IteratorResult<SDKUserMessage>) => void) | undefined
  private pending: { resolve(result: TurnResult): void; reject(error: Error): void; text: string; streamed: boolean } | undefined
  private catalog: NativeCommand[] = []
  constructor(private readonly options: SessionOptions, private readonly executable = 'claude') {}
  async initialize(): Promise<{ threadId: string; model: string }> {
    if (this.connection || this.closed) throw new Error('会话不能重复初始化')
    if (this.options.resumeThreadId) this.threadId = this.options.resumeThreadId
    const self = this
    const input: AsyncIterable<SDKUserMessage> = { [Symbol.asyncIterator]() { return {
      next: () => self.closed ? Promise.resolve({ done: true, value: undefined }) : new Promise(resolve => { self.wake = resolve }),
    } } }
    // 指定本机程序，不运行 SDK 附带的另一份 CLI；加载原生项目与用户配置。
    const path = this.executable.includes('/') ? this.executable : execFileSync('/usr/bin/which', [this.executable], { encoding: 'utf8' }).trim()
    this.connection = query({ prompt: input, options: {
      ...(this.options.env ? { env: this.options.env } : {}), cwd: this.options.cwd, pathToClaudeCodeExecutable: path,
      settingSources: ['user', 'project', 'local'], systemPrompt: { type: 'preset', preset: 'claude_code' },
      ...(this.options.resumeThreadId ? { resume: this.threadId } : { sessionId: this.threadId }),
      includePartialMessages: true,
      canUseTool: async (tool, input, options) => {
        if (!this.options.interact) return { behavior: 'deny', message: '当前入口没有交互处理器' }
        return answerToolPermission(tool, input, options, this.options.interact)
      },
    } })
    void this.consume()
    const init = await this.connection.initializationResult()
    try { const account = await this.connection.accountInfo(); this.options.onTelemetry?.({ authSource: account.tokenSource || account.apiKeySource || '原生未报告', billing: account.subscriptionType ? `${account.subscriptionType} 订阅 · 额外用量待检测` : `${account.apiProvider ?? '原生'} · 计费类型未确认` }) } catch { /* 旧原生接口缺失时不推测账号或计费方式。 */ }
    this.catalog = init.commands.map(command => ({ name: command.name, description: command.description }))
    this.options.onCommands?.(this.catalog)
    try { this.model = (await this.connection.getContextUsage({ detail: 'summary' })).model } catch { /* 老版本没有此状态接口时，首轮 init 仍提供真实模型。 */ }
    this.options.onTelemetry?.({ threadId: this.threadId, model: this.model, provider: 'Claude Code', executable: path, configDirectory: this.options.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), approval: '等待原生报告' })
    return { threadId: this.threadId, model: this.model }
  }
  private async consume(): Promise<void> {
    try {
      for await (const message of this.connection!) this.receive(message)
      if (!this.closed) throw new Error('Claude Code 连接已结束')
    } catch {
      if (!this.closed) {
        const error = new Error('Claude Code 连接失败或中断；未完成操作结果未知')
        this.pending?.reject(error); this.pending = undefined
        this.options.onDisconnect?.(error)
        await this.close()
      }
    }
  }
  private receive(message: SDKMessage): void {
    if (message.type === 'system' && message.subtype === 'init') {
      this.threadId = message.session_id; this.model = message.model
      this.options.onTelemetry?.({ threadId: this.threadId, model: this.model, approval: message.permissionMode, ...(message.effort ? { effort: message.effort } : {}) })
    }
    if (message.type === 'system' && message.subtype === 'local_command_output') {
      this.options.onEvent?.({ type: 'notice', text: message.content })
    }
    const active = this.pending
    if (!active) return
    if (message.type === 'stream_event' && message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta') {
      const text = message.event.delta.text; active.text += text; active.streamed = true
      this.options.onEvent?.({ type: 'text', text })
    }
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text' && !active.streamed) { active.text += block.text; this.options.onEvent?.({ type: 'text', text: block.text }) }
        if (block.type === 'tool_use') this.options.onEvent?.({ type: 'tool', text: block.name, tool: { id: block.id, name: block.name, input: block.input, status: 'running' } })
      }
      active.streamed = false
    }
    if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) if (block.type === 'tool_result') {
        const output = typeof block.content === 'string' ? block.content : (block.content ?? []).flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
        this.options.onEvent?.({ type: 'tool', text: '', tool: { id: block.tool_use_id, name: '', output, status: block.is_error ? 'failed' : 'completed' } })
      }
    }
    if (message.type === 'result') {
      const models = Object.values(message.modelUsage ?? {})
      const input = models.reduce((n, m) => n + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0)
      const output = models.reduce((n, m) => n + m.outputTokens, 0)
      const cache = models.reduce((n, m) => n + m.cacheReadInputTokens, 0)
      const last = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0) + message.usage.output_tokens
      this.options.onTelemetry?.({ usage: { total: input + output, input, output, cached: cache, reasoning: models.reduce((n, m) => n + (m.thinkingTokens ?? 0), 0), last, contextWindow: models.length === 1 ? models[0]!.contextWindow : null } })
      this.pending = undefined
      active.resolve({ status: this.cancelling ? 'cancelled' : message.is_error ? 'failed' : 'completed', text: active.text || (message.subtype === 'success' ? message.result : '') })
      this.cancelling = false
    }
  }
  async run(text: string): Promise<TurnResult> {
    if (!this.connection || this.closed) throw new Error('Claude Code 未连接')
    if (this.pending) throw new Error('Claude Code 忙碌')
    if (!text.trim()) throw new Error('消息不能为空')
    // SDK 已通过 initialize 才接受输入；yield 后 next() 重新挂起，保持同一进程连续对话。
    if (!this.wake) throw new Error('Claude Code 输入尚未就绪')
    const result = new Promise<TurnResult>((resolve, reject) => { this.pending = { resolve, reject, text: '', streamed: false } })
    const wake = this.wake; this.wake = undefined
    wake({ done: false, value: { type: 'user', uuid: randomUUID(), session_id: this.threadId, parent_tool_use_id: null, message: { role: 'user', content: text } } })
    const timer = setTimeout(() => { this.pending?.reject(new Error('Claude Code 轮次超时，结果未知')); void this.close() }, this.options.turnTimeoutMs ?? 600_000)
    try { return await result } finally { clearTimeout(timer) }
  }
  async choices(name: 'model' | 'effort'): Promise<import('../../room/conversation.js').CommandChoice[]> {
    if (!this.connection) throw new Error('Claude Code 未连接')
    const models = await this.connection.supportedModels()
    if (name === 'model') return models.map(model => ({ value: model.value, label: model.displayName, description: model.description, current: model.value === this.model || model.resolvedModel === this.model }))
    const model = models.find(model => model.value === this.model || model.resolvedModel === this.model)
    return (model?.supportedEffortLevels ?? []).map(value => ({ value, label: value, description: '原生模型支持的思考强度', current: value === this.effort }))
  }
  async command(name: string, argument: string): Promise<string> {
    const q = this.connection
    if (!q || this.closed) throw new Error('Claude Code 未连接')
    if (this.pending) throw new Error('请等待当前轮次结束')
    if (name === 'model') {
      const models = await q.supportedModels()
      if (!argument) return models.map(model => `${model.value} · ${model.displayName}`).join('\n')
      if (!models.some(model => model.value === argument)) throw new Error('模型不在原生列表中')
      await q.setModel(argument); this.model = argument; this.options.onTelemetry?.({ model: argument }); return `模型已切换：${argument}`
    }
    if (name === 'effort' && argument) { const choices = await this.choices('effort'); if (!choices.some(choice => choice.value === argument)) throw new Error('当前原生模型未报告此思考强度'); const result = await this.run(`/effort ${argument}`); if (result.status !== 'completed') throw new Error('原生思考强度切换失败'); this.effort = argument; this.options.onTelemetry?.({ effort: argument }); return result.text || `思考强度：${argument}` }
    if (name === 'mcp') return (await q.mcpServerStatus()).map(server => `${server.name} · ${server.status}`).join('\n') || '未配置 MCP'
    if (name === 'skills') return this.catalog.map(command => `/${command.name} · ${command.description}`).join('\n')
    if (name === 'usage' || name === 'cost') {
      const usage = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
      const quotas = readClaudeQuotas(usage.rate_limits)
      this.options.onTelemetry?.({ quotas, billing: usage.subscription_type ? `${usage.subscription_type} 订阅 · ${usage.rate_limits?.extra_usage?.is_enabled === true ? '额外用量已启用' : usage.rate_limits?.extra_usage?.is_enabled === false ? '额外用量未启用' : '额外用量状态未知'}` : '当前认证未报告订阅类型', quotaError: quotas.length ? '' : (usage.rate_limits_available ? '原生额度查询暂未返回数据 · /usage 重试' : '当前认证不提供订阅额度 · /setup 选择本机登录') })
      return `API 等价估算 $${usage.session.total_cost_usd.toFixed(4)}（不是实际扣费凭据）${usage.subscription_type ? ` · ${usage.subscription_type}` : ''}`
    }
    if (!this.catalog.some(command => command.name === name)) throw new Error('当前 Claude Code 未提供此命令')
    const result = await this.run(`/${name}${argument ? ' ' + argument : ''}`)
    if (result.status === 'failed') throw new Error('原生命令执行失败')
    return result.text || '原生命令已结束'
  }
  async cancel(): Promise<void> { if (this.pending) { this.cancelling = true; await this.connection?.interrupt() } }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true; this.pending?.reject(new Error('Claude Code 已关闭')); this.pending = undefined
    this.wake?.({ done: true, value: undefined }); this.wake = undefined
    this.connection?.close()
  }
}
export const openClaudeSession = (options: SessionOptions, command?: string): ClaudeSession => new ClaudeSession(options, command)
