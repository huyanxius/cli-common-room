import { execFile, spawn } from 'node:child_process'
import { promisify, stripVTControlCharacters } from 'node:util'
import type { MemberId } from '../room/context.js'
const clean = (value: string): string => stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
const exec = promisify(execFile)
export interface NativeStatus { installed: boolean; auth: 'signed-in' | 'signed-out' | 'unknown'; version: string; detail: string }
interface NativeOptions { env?: NodeJS.ProcessEnv; cwd?: string }
export interface NativeLogin { done: Promise<void>; send(text: string): void; cancel(): void }
export async function inspectNative(member: MemberId, executable: string, options: NativeOptions = {}): Promise<NativeStatus> {
  let version: string
  try { version = clean((await exec(executable, ['--version'], { ...options, timeout: 8000, maxBuffer: 65536 })).stdout).trim().slice(0, 100) }
  catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
    return { installed: !missing, auth: 'unknown', version: '', detail: missing ? '未找到程序 · 配置路径或安装后重新检测' : '程序检测失败 · 检查路径、权限或重试' }
  }
  let stdout = '', stderr = '', code = 0
  try {
    const result = await exec(executable, member === 'claude' ? ['auth', 'status', '--json'] : ['login', 'status'], { ...options, timeout: 10000, maxBuffer: 65536 })
    stdout = result.stdout; stderr = result.stderr
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; code?: number }
    stdout = result.stdout ?? ''; stderr = result.stderr ?? ''; code = result.code ?? -1
  }
  // 原生状态可能带邮箱、账号 ID 或密钥片段，只返回白名单结果。
  let auth: NativeStatus['auth'] = 'unknown'
  if (member === 'claude') {
    try { const result = JSON.parse(stdout) as { loggedIn?: boolean }; if (typeof result.loggedIn === 'boolean') auth = result.loggedIn ? 'signed-in' : 'signed-out' } catch { /* 旧版或第三方入口保留未知状态。 */ }
  } else {
    const text = stdout + stderr
    if (code === 0 && /Logged in/i.test(text)) auth = 'signed-in'
    else if (/Not logged in/i.test(text)) auth = 'signed-out'
  }
  return { installed: true, auth, version, detail: auth === 'signed-in' ? '检测到原生认证 · 尚未验证模型请求' : auth === 'signed-out' ? '未登录 · 选择浏览器登录' : '认证状态未确认 · 可重新检测或使用现有配置连接' }
}
export function loginNative(member: MemberId, executable: string, options: NativeOptions & { onOutput(text: string): void; method?: 'browser' | 'device' | 'console' }): NativeLogin {
  const args = member === 'claude' ? ['auth', 'login', options.method === 'console' ? '--console' : '--claudeai'] : ['login', ...(options.method === 'device' ? ['--device-auth'] : [])]
  const child = spawn(executable, args, { ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}), shell: false, stdio: 'pipe' })
  let cancelled = false, output = '', killTimer: ReturnType<typeof setTimeout> | undefined
  const append = (chunk: string): void => { output = clean(output + chunk).slice(-16000); options.onOutput(output) }
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', append); child.stderr.on('data', append)
  child.stdin.on('error', () => {})
  const cancel = (): void => {
    if (child.exitCode !== null || child.signalCode !== null) return
    cancelled = true; child.kill('SIGTERM')
    killTimer = setTimeout(() => child.kill('SIGKILL'), 500); killTimer.unref()
  }
  const timeout = setTimeout(cancel, 5 * 60_000); timeout.unref()
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', () => { clearTimeout(timeout); clearTimeout(killTimer); reject(new Error('登录程序启动失败，请检查路径')) })
    child.once('close', code => {
      clearTimeout(timeout); clearTimeout(killTimer)
      if (cancelled) reject(new Error('登录已取消或超时；可重新登录'))
      else if (code !== 0) reject(new Error('原生登录失败，请查看上方提示后重试'))
      else resolve()
    })
  })
  return { done, cancel, send: text => { if (!cancelled && child.exitCode === null) child.stdin.write(text.replace(/[\r\n]/g, '') + '\n') } }
}

// 仅在用户选择本机登录来源后移除环境认证覆盖；不读取或复制凭据。
export function authenticationEnv(source: 'inherit' | 'native' = 'inherit'): NodeJS.ProcessEnv {
  return source === 'native' ? { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: undefined, CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: undefined, ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined } : { ...process.env }
}
