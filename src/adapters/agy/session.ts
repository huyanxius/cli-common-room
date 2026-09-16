import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import type { Conversation, SessionOptions, TurnResult, NativeCommand } from '../../room/conversation.js'

const exec = promisify(execFile)
const commands: NativeCommand[] = ['usage', 'credits', 'model', 'effort', 'skills', 'agents', 'hooks', 'permissions', 'config', 'changelog'].map(name => ({ name, description: `AGY 原生 ${name}（只读）` }))
type Pending<T> = { resolve(value: T): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
type RecordValue = Record<string, any>

export function openAgySession(options: SessionOptions, executable = 'agy', prefix: string[] = []): Conversation {
  return new AgySession(options, executable, prefix)
}

class AgySession implements Conversation {
  private child: ChildProcessWithoutNullStreams | undefined
  private initialized: Promise<{ threadId: string; model: string }> | undefined
  private init: Pending<{ threadId: string; model: string }> | undefined
  private turn: Pending<TurnResult> | undefined
  private threadId = ''
  private text = ''
  private stderr = ''
  private closed = false
  private exited: Promise<void> = Promise.resolve()
  private resultTimer: ReturnType<typeof setTimeout> | undefined
  private reportController: AbortController | undefined
  constructor(private readonly options: SessionOptions, private readonly executable: string, private readonly prefix: string[]) {}

  initialize(): Promise<{ threadId: string; model: string }> {
    if (this.closed) return Promise.reject(new Error('AGY 连接已关闭'))
    if (this.initialized) return this.initialized
    this.initialized = new Promise((resolve, reject) => {
      this.init = { resolve, reject, timer: setTimeout(() => this.fail(new Error('AGY 初始化超时')), 30_000) }
      // 原生超时会把部分输出标为 SUCCESS；本地先超时，不能推进交付游标。
      const seconds = Math.ceil((this.options.turnTimeoutMs ?? 300_000) / 1000) + 30
      const args = [...this.prefix, '--input-format', 'stream-json', '--output-format', 'stream-json', '--print-timeout', `${seconds}s`, ...(this.options.resumeThreadId ? ['--conversation', this.options.resumeThreadId] : []), '--print=']
      const child = this.child = spawn(this.executable, args, { cwd: this.options.cwd, env: this.options.env ?? process.env, stdio: 'pipe', shell: false })
      this.exited = new Promise(done => child.once('close', () => done()))
      child.stdin.on('error', () => this.fail(new Error('AGY 输入连接关闭，交付结果未知')))
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        this.stderr = (this.stderr + chunk).slice(-16_000)
        if (/print timeout|returning partial output|response may be truncated/i.test(this.stderr)) this.fail(new Error('AGY 返回部分结果，交付状态未知；不会自动重发'))
      })
      const lines = createInterface({ input: child.stdout })
      lines.on('line', line => {
        if (this.closed || !line.trim()) return
        try { this.event(JSON.parse(line) as RecordValue) }
        catch { this.fail(new Error('AGY 协议无效，交付状态未知')) }
      })
      child.once('error', () => this.fail(new Error('AGY 程序启动失败，请检查路径和原生登录')))
      child.once('close', () => { lines.close(); if (!this.closed) this.fail(new Error('AGY 原生连接关闭，交付结果未知')) })
    })
    return this.initialized
  }

  private event(value: RecordValue): void {
    if (value.event === 'init') {
      const id = value.conversation_id
      if (!this.init || typeof id !== 'string' || !id || (this.options.resumeThreadId && id !== this.options.resumeThreadId)) {
        this.fail(new Error('AGY 会话恢复失败：原生 ID 不匹配')); return
      }
      this.threadId = id
      this.options.onTelemetry?.({ threadId: id, executable: this.executable, approval: value.init?.permission_mode ?? '未报告' })
      this.options.onCommands?.(commands)
      this.options.onEvent?.({ type: 'notice', text: 'AGY 沿用原生权限。流式接口不提供审批/提问回传；需审批的工具由原生拒绝，不能在 room 中放行。' })
      const pending = this.init; this.init = undefined; clearTimeout(pending.timer)
      pending.resolve({ threadId: id, model: '原生未报告' })
      return
    }
    if (!this.turn) { this.fail(new Error('AGY 返回了无对应轮次的事件')); return }
    if (value.event === 'step_update') {
      const step = value.step_update
      if (!step || step.conversation_id !== this.threadId) { this.fail(new Error('AGY 事件会话不匹配')); return }
      if (typeof step.text_delta === 'string') {
        this.text += step.text_delta
        this.options.onEvent?.({ type: 'text', text: step.text_delta })
      }
      if (step.tool_info) {
        const info = step.tool_info
        this.options.onEvent?.({ type: 'tool', text: '', tool: { id: `${this.threadId}:${step.step_index}`, name: info.name ?? info.tool_name ?? step.step_type,
          ...(info.parameters !== undefined ? { input: info.parameters } : {}), ...(info.output !== undefined ? { output: typeof info.output === 'string' ? info.output : JSON.stringify(info.output) } : {}),
          status: step.state === 'DONE' ? 'completed' : step.state === 'ERROR' ? 'failed' : 'running' } })
      }
      return
    }
    if (value.event !== 'result') { this.fail(new Error('AGY 返回不支持的交互事件，已关闭连接；未自动授权')); return }
    const result = value.result
    if (!result || result.conversation_id !== this.threadId || typeof result.response !== 'string' || !['SUCCESS', 'ERROR', 'CANCELLED'].includes(result.status)) {
      this.fail(new Error('AGY 结果格式或会话 ID 无效')); return
    }
    if (this.resultTimer) { this.fail(new Error('AGY 重复结束事件')); return }
    // 留出一次流排空，让同批 stderr 的截断警告先否决成功结果。
    this.resultTimer = setTimeout(() => {
      this.resultTimer = undefined
      if (!this.turn) return
      if (result.status === 'SUCCESS' && !result.response.trim()) { this.fail(new Error('AGY 未返回完整答复，交付结果未知')); return }
      if (result.response.startsWith(this.text)) {
        const tail = result.response.slice(this.text.length)
        if (tail) this.options.onEvent?.({ type: 'text', text: tail })
      }
      const u = result.usage
      if (u && ['total_tokens', 'input_tokens', 'output_tokens', 'thinking_tokens', 'cache_read_tokens'].every(key => Number.isFinite(u[key]) && u[key] >= 0)) this.options.onTelemetry?.({ usage: { total: u.total_tokens, input: u.input_tokens, output: u.output_tokens, reasoning: u.thinking_tokens, cached: u.cache_read_tokens, last: u.total_tokens, contextWindow: null } })
      const denied = Array.isArray(result.denied_actions) && result.denied_actions.length > 0
      if (denied) this.options.onEvent?.({ type: 'notice', text: `AGY 原生拒绝了需要审批的操作：${JSON.stringify(result.denied_actions)}。未绕过审批。` })
      if (result.error) this.options.onEvent?.({ type: 'notice', text: String(result.error) })
      const pending = this.turn; this.turn = undefined; clearTimeout(pending.timer)
      pending.resolve({ status: result.status === 'CANCELLED' ? 'cancelled' : result.status === 'SUCCESS' && !denied ? 'completed' : 'failed', text: result.response })
    }, 20)
  }

  async run(text: string): Promise<TurnResult> {
    await this.initialize()
    if (this.closed) throw new Error('AGY 连接已关闭')
    if (this.turn || this.reportController) throw new Error('AGY 正在执行')
    this.text = ''; this.stderr = ''
    return new Promise((resolve, reject) => {
      this.turn = { resolve, reject, timer: setTimeout(() => this.fail(new Error('AGY 请求超时，交付结果未知')), this.options.turnTimeoutMs ?? 300_000) }
      this.child!.stdin.write(JSON.stringify({ event: 'user', message: { role: 'user', content: text } }) + '\n')
    })
  }

  async command(name: string, argument: string): Promise<string> {
    if (!commands.some(command => command.name === name) || argument.trim()) throw new Error('AGY 当前仅支持原生只读命令；模型与权限修改请在原生配置后重新连接')
    if (this.closed || this.turn || this.reportController) throw new Error('AGY 连接不可用或正在执行')
    const controller = this.reportController = new AbortController()
    try {
      const { stdout } = await exec(this.executable, [...this.prefix, '--output-format', 'json', ...(this.threadId ? ['--conversation', this.threadId] : []), `--print=/${name}`], { cwd: this.options.cwd, env: this.options.env ?? process.env, timeout: 20_000, maxBuffer: 1024 * 1024, signal: controller.signal })
      const result = JSON.parse(stdout) as RecordValue
      if (result.status !== 'SUCCESS' || result.command?.name !== name || typeof result.response !== 'string') throw new Error('AGY 原生命令未确认成功')
      if (name === 'model' && typeof result.command.data?.id === 'string') this.options.onTelemetry?.({ model: result.command.data.id, effort: result.command.data.effort })
      return result.response
    } finally { this.reportController = undefined }
  }

  private fail(error: Error): void {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.resultTimer)
    for (const pending of [this.init, this.turn]) if (pending) { clearTimeout(pending.timer); pending.reject(error) }
    this.init = undefined; this.turn = undefined
    this.reportController?.abort()
    this.options.onDisconnect?.(error)
    this.child?.kill('SIGINT')
    const child = this.child
    if (child) { const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 1000); timer.unref(); child.once('close', () => clearTimeout(timer)) }
  }
  async cancel(): Promise<void> { if (this.turn || this.reportController) { this.fail(new Error('AGY 已请求停止，原生未提供停止确认，交付结果未知')); await this.exited } }
  async close(): Promise<void> { this.fail(new Error('AGY 连接已关闭')); await this.exited }
}
