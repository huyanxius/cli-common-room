import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'

export interface RpcOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
}
interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

// Codex stdio 使用一行一个 JSON 对象；不能按 stdout 的数据块边界解析，也不经 shell 拼接命令。
export class StdioRpc {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<number, Pending>()
  private readonly exited: Promise<void>
  private readonly timeoutMs: number
  private nextId = 1
  private buffer = ''
  private stopped = false
  private killTimer: ReturnType<typeof setTimeout> | undefined

  constructor(command: string, args: readonly string[], options: RpcOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('超时必须是正整数')
    const spawnOptions: SpawnOptionsWithoutStdio = { shell: false }
    if (options.cwd !== undefined) spawnOptions.cwd = options.cwd
    if (options.env !== undefined) spawnOptions.env = { ...process.env, ...options.env }
    this.child = spawn(command, [...args], spawnOptions)
    this.exited = new Promise(resolve => {
      this.child.once('close', () => {
        this.stop(new Error('原生进程已退出，未完成请求的执行结果未知'))
        clearTimeout(this.killTimer)
        resolve()
      })
    })
    this.child.once('error', () => this.stop(new Error('原生进程启动失败，请检查程序路径和运行权限')))
    this.child.stdin.on('error', () => this.stop(new Error('原生进程输入通道不可用')))
    this.child.stdout.on('error', () => this.stop(new Error('原生进程输出通道不可用')))
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.receive(chunk))
    // 必须排空 stderr，避免子进程阻塞；它可能包含个人路径或上下文，不直接展示或保存。
    this.child.stderr.resume()
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (this.stopped) throw new Error('原生连接已关闭')
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new Error('原生请求超时，执行结果未知；不会自动重试')), this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }

  notify(method: string): void {
    if (this.stopped) throw new Error('原生连接已关闭')
    this.write({ method })
  }

  async close(): Promise<void> {
    this.stop(new Error('原生连接已关闭'))
    await this.exited
  }

  private write(message: unknown): void {
    try { this.child.stdin.write(JSON.stringify(message) + '\n') }
    catch { this.stop(new Error('无法发送原生协议消息')) }
  }

  private receive(chunk: string): void {
    if (this.stopped) return
    this.buffer += chunk
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (line.length > 1_048_576) { this.stop(new Error('原生协议消息超过大小限制')); return }
      if (!line.trim()) continue
      try {
        const message: unknown = JSON.parse(line)
        this.handle(message)
      } catch { this.stop(new Error('收到无效的原生协议消息')); return }
      if (this.stopped) return
    }
    if (this.buffer.length > 1_048_576) this.stop(new Error('原生协议消息超过大小限制'))
  }

  private handle(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid message')
    const message = value as Record<string, unknown>
    if (typeof message.method === 'string') {
      if (typeof message.id === 'string' || typeof message.id === 'number') {
        // 握手诊断不支持审批等服务端请求；明确失败，禁止静默批准。
        this.write({ id: message.id, error: { code: -32601, message: 'This client does not support server requests yet' } })
      }
      return
    }
    if (typeof message.id !== 'number') throw new Error('Invalid response ID')
    const pending = this.pending.get(message.id)
    if (!pending) return
    if (!('result' in message) && !('error' in message)) throw new Error('Invalid response')
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if ('error' in message) {
      const code = message.error && typeof message.error === 'object' && 'code' in message.error
        && typeof message.error.code === 'number' ? message.error.code : 'unknown'
      pending.reject(new Error(`原生请求失败（错误码 ${code}）`))
    } else pending.resolve(message.result)
  }

  private stop(error: Error): void {
    if (this.stopped) return
    this.stopped = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.child.stdin.end()
    if (this.child.pid && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM')
      this.killTimer = setTimeout(() => this.child.kill('SIGKILL'), 500)
      this.killTimer.unref()
    }
  }
}
