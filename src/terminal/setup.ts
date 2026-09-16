import type { MemberId } from '../room/context.js'
import type { NativeStatus } from '../runtime/native-auth.js'
import type { Line } from './screen.js'
import { fit, wrap, width, graphemes } from './text.js'
export interface SetupState {
  authSource: 'inherit' | 'native'; view: 'welcome' | MemberId; index: number; pending: boolean; status: string; output: string
  input: string; inputCursor?: number; editing: 'path' | 'code' | undefined
  binaries: Record<MemberId, string>; members: Record<MemberId, NativeStatus | undefined>
}
export const createSetup = (): SetupState => ({ authSource: 'inherit', view: 'welcome', index: 0, pending: false, status: '连接你的原生 Agent', output: '', input: '', editing: undefined, binaries: { codex: 'codex', claude: 'claude' }, members: { codex: undefined, claude: undefined } })
export function setupActions(state: SetupState): { id: string; label: string }[] {
  if (state.pending) return [{ id: 'cancel', label: '取消当前操作' }]
  if (state.editing) return [{ id: 'save-path', label: '保存路径并检测' }, { id: 'back', label: '取消修改' }]
  if (state.view === 'welcome') return [
    { id: 'codex', label: '配置 Codex' }, { id: 'claude', label: '配置 Claude Code' },
    { id: 'all', label: '双方进入工作区' }, { id: 'use-codex', label: '先使用 Codex' }, { id: 'use-claude', label: '先使用 Claude Code' },
    { id: 'refresh', label: '重新检测' }, { id: 'close', label: '返回工作区 / 退出' },
  ]
  return [
    { id: 'login', label: '浏览器登录 / 重新登录' },
    { id: 'alternate', label: state.view === 'codex' ? '使用设备码登录' : '使用 Anthropic Console 登录（API 计费）' },
    ...(state.view === 'claude' ? [{ id: 'source', label: state.authSource === 'inherit' ? '切换为本机登录（不使用环境令牌）' : '切换为沿用启动环境认证' }] : []),
    { id: 'path', label: '设置程序路径' }, { id: 'refresh', label: '重新检测登录状态' },
    { id: `use-${state.view}`, label: '使用现有配置进入工作区' }, { id: 'back', label: '返回成员选择' },
  ]
}
export function renderSetup(state: SetupState, columns: number, rows: number, tick: number): { lines: Line[]; cursor: { row: number; column: number }; maxScroll: number } {
  const cols = Math.max(1, columns - 1), height = Math.max(1, rows)
  const left = cols >= 80 ? Math.max(4, Math.floor(cols * 0.08)) : 1, content = Math.max(1, cols - left * 2)
  const line = (text = '', tone: Line['tone'] = 'muted'): Line => ({ text: fit(' '.repeat(left) + text, cols), tone })
  const tone = state.view === 'claude' ? 'claude' : state.view === 'codex' ? 'codex' : 'bright'
  const body: Line[] = [line('COMMON ROOM', 'bright'), line('你的工作区 · 你的原生 Agent'), line()]
  if (height >= 25 && cols >= 78) {
    body.splice(0, 3)
    const logo = [' █▀▀ █▀█ █▀▄▀█ █▀▄▀█ █▀█ █▄ █   █▀█ █▀█ █▀█ █▀▄▀█', ' █▄▄ █▄█ █ ▀ █ █ ▀ █ █▄█ █ ▀█   █▀▄ █▄█ █▄█ █ ▀ █', '', 'NATIVE AGENTS · SHARED WORKSPACE']
    body.push(...logo.map(text => line(' '.repeat(Math.max(0, Math.floor((content - width(text)) / 2))) + text, 'bright')), line(), line())
  }
  body.push(line(state.view === 'welcome' ? '欢迎。先连接一起工作的成员。' : state.view === 'claude' ? 'CLAUDE CODE  /  账号与连接' : 'CODEX  /  账号与连接', tone))
  body.push(line('─'.repeat(content)))
  const members: MemberId[] = state.view === 'welcome' ? ['codex', 'claude'] : [state.view]
  for (const member of members) {
    const info = state.members[member]
    const badge = !info ? '尚未检测' : !info.installed ? '未安装 / 路径不可用' : info.auth === 'signed-in' ? '已检测到登录' : info.auth === 'signed-out' ? '未登录' : '待确认'
    body.push(line(`${member === 'codex' ? 'Codex' : 'Claude Code'}   ${badge}`, member))
    if (height >= 20) body.push(line(info?.version || state.binaries[member]))
    if (state.view !== 'welcome') {
      if (member === 'claude') body.push(line(`认证来源：${state.authSource === 'native' ? '本机登录' : '沿用启动环境'}`))
      body.push(...wrap(state.binaries[member], content).map(text => line(text)))
      body.push(...wrap(info?.detail ?? '检测程序与登录状态后继续。', content).map(text => line(text)))
      if (info && !info.installed) body.push(...wrap(member === 'codex' ? '安装：npm install -g @openai/codex' : '安装说明：https://code.claude.com/docs/en/setup', content).map(text => line(text)))
    }
    body.push(line())
  }
  const spinner = state.pending ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][tick % 10] + ' ' : ''
  body.push(...wrap(spinner + state.status, content).map(text => line(text, tone)))
  if (state.output) body.push(...wrap(state.output, content).slice(-Math.max(3, Math.floor(height / 3))).map(text => line(text, 'bright')))
  const actions = setupActions(state), index = Math.min(state.index, actions.length - 1)
  const menu = actions.map((action, i) => line(`${i === index ? '›' : ' '} ${action.label}`, i === index ? tone : 'muted'))
  const editor = state.editing ? [line(state.editing === 'code' ? '浏览器完成登录；仅原生要求时输入验证码（不保存）' : '程序路径（不要填 shell alias 或命令参数）'), line(`> ${fit(state.editing === 'code' ? '*'.repeat(graphemes(state.input).length) : state.input, Math.max(1, content - 2))}`, 'bright')] : []
  const footer = [line(), line('↑↓ 选择 · Enter 确认 · Esc 返回 · Ctrl+C 取消/退出')]
  const menuHeight = Math.min(menu.length, Math.max(1, height - editor.length - footer.length - 3))
  const menuStart = Math.max(0, index - menuHeight + 1)
  const visibleMenu = menu.slice(menuStart, menuStart + menuHeight)
  const space = Math.max(0, height - visibleMenu.length - editor.length - footer.length)
  const visibleBody = body.length > space ? [body[0]!, ...body.slice(-(Math.max(0, space - 1)))].slice(0, space) : body
  const used = visibleBody.length + visibleMenu.length + editor.length + footer.length
  const top = Math.min(4, Math.max(0, Math.floor((height - used) / 3)))
  const lines = [...Array.from({ length: top }, () => line()), ...visibleBody, ...visibleMenu, ...editor]
  while (lines.length < height - footer.length) lines.push(line())
  lines.push(...footer)
  lines.splice(height)
  return { lines, cursor: { row: Math.min(height, top + visibleBody.length + visibleMenu.length + editor.length), column: Math.min(cols, left + 3 + width(state.editing === 'code' ? '*'.repeat(state.inputCursor ?? graphemes(state.input).length) : graphemes(state.input).slice(0, state.inputCursor ?? graphemes(state.input).length).join(''))) }, maxScroll: 0 }
}
