import { openClaudeSession } from './adapters/claude/session.js'
import { openAgySession } from './adapters/agy/session.js'
import { createApplication } from './app.js'
import { SetupPreferences } from './storage/setup.js'
import { terminalWorkspace } from './terminal/workspace.js'

const args = process.argv.slice(2)
const help = `用法：room [--codex-bin 路径] [--claude-bin 路径] [--agy-bin 路径]

在当前工作目录打开 Claude Code、Codex 与 AGY 的统一 TUI。
/to codex|claude|agy|all 选择接收者；@codex @agy 可多成员点名，all 选择全部成员。

--setup        打开成员配置与原生登录引导
--status       查看支持的连接入口，不启动会话
--check-codex  检查原生协议握手
--help         显示帮助
--version      显示版本
--codex-chat   兼容旧入口，等同默认 TUI

原生认证、工具、配置和审批保持生效。`
try {
  let mode = 'tui', codexBin: string | undefined, claudeBin: string | undefined, agyBin: string | undefined
  const switches = new Set<string>()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!
    if (switches.has(flag)) throw new Error('不支持重复参数')
    switches.add(flag)
    if (flag === '--codex-bin' || flag === '--claude-bin' || flag === '--agy-bin') {
      const path = args[++index]
      if (!path?.trim() || path.startsWith('--')) throw new Error('程序路径不能为空')
      if (flag === '--codex-bin') codexBin = path; else if (flag === '--agy-bin') agyBin = path; else claudeBin = path
    } else if (['--help', '--status', '--version', '--check-codex', '--codex-chat', '--setup'].includes(flag)) {
      if (mode !== 'tui' || (flag !== '--codex-chat' && switches.has('--codex-chat'))) throw new Error('不支持同时指定多个启动模式')
      mode = flag.slice(2)
    } else throw new Error('不支持此命令。使用 --help 查看帮助。')
  }
  if (mode === 'help') console.log(help)
  else if (mode === 'version') console.log('room 0.0.0')
  else if (mode === 'status') console.log('Claude Code：本机 CLI + 官方 SDK\nCodex：本机 app-server\nAGY：本机 stream-json（原生拒绝需审批工具；不支持交互审批回传）\n运行 room 连接当前工作区；状态列表不代表认证或模型请求已验证。')
  else if (mode === 'check-codex') {
    try { await createApplication().checkCodexConnection(codexBin); console.log('Codex 原生协议握手成功。未发送模型请求。') }
    catch (error) { console.error(error instanceof Error ? error.message : '连接失败'); process.exitCode = 1 }
  } else {
    try { const store = new SetupPreferences(); const settings = await store.load(); if (codexBin) settings.binaries.codex = codexBin; if (claudeBin) settings.binaries.claude = claudeBin; if (agyBin) settings.binaries.agy = agyBin; await terminalWorkspace({ codex: options => createApplication().openCodexSession(options, settings.binaries.codex), claude: options => openClaudeSession(options, settings.binaries.claude), agy: options => openAgySession(options, settings.binaries.agy ?? 'agy') }, { store, settings, force: mode === 'setup' }) }
    catch (error) { console.error(error instanceof Error ? error.message : '会话失败'); process.exitCode = 1 }
  }
} catch (error) { console.error(error instanceof Error ? error.message : '参数错误'); process.exitCode = 2 }
