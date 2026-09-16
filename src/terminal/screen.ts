import type { Telemetry } from '../room/telemetry.js'
import type { Editor } from './editor.js'
import { fit, wrap, width, graphemes } from './text.js'
import { quotaLines, tokenLine } from './metrics.js'
export interface Message { role: string; text: string }
export interface ScreenState {
  member?: string; secret?: boolean; menuIndex?: number; members?: { name: string; telemetry: Telemetry }[]; telemetry: Telemetry; cwd: string; git: string; status: string; messages: Message[]
  editor: Editor; scroll: number; menu: string[]; promptTitle: string; seconds: number
}
export interface Line { text: string; tone: 'bright' | 'muted' | 'accent' | 'codex' | 'claude' }
const wrapped = new WeakMap<Message, { text: string; columns: number; lines: string[] }>()
function messageLines(message: Message, columns: number): string[] {
  const cached = wrapped.get(message)
  if (cached?.text === message.text && cached.columns === columns) return cached.lines
  const lines = wrap(message.text, columns)
  wrapped.set(message, { text: message.text, columns, lines }); return lines
}
export function renderScreen(state: ScreenState, columns: number, rows: number): { lines: Line[]; cursor: { row: number; column: number }; maxScroll: number } {
  const cols = Math.max(1, columns - 1), height = Math.max(1, rows)
  const line = (text = '', tone: Line['tone'] = 'muted'): Line => ({ text: fit(text, cols), tone })
  const accent = state.promptTitle.toLowerCase().startsWith('claude') || state.member === 'Claude Code' ? 'claude' : state.member === 'Codex + Claude Code' ? 'accent' : 'codex'
  const head = [line(`COMMON ROOM  /  ${state.status}${state.seconds ? ` ${state.seconds}s` : ''}  /  ${state.telemetry.model ?? '连接中'}`, 'bright')]
  if (height >= 12) {
    head.push(line(`${state.cwd}  ·  ${state.git}`))
    if (!state.members) {
    head.push(line(`${state.telemetry.provider ?? '原生配置'} · effort ${state.telemetry.effort ?? '—'} · ${state.telemetry.sandbox ?? '—'} · approval ${state.telemetry.approval ?? '—'}`))
    head.push(line(tokenLine(state.telemetry.usage)))
    head.push(line(state.telemetry.quotaError || quotaLines(state.telemetry.quotas ?? []).join('  |  ')))
    }
    if (state.members && height >= 12) for (const member of state.members) {
      head.push(line(`${member.name} · ${member.telemetry.model ?? '未连接'} · ${tokenLine(member.telemetry.usage)}`, member.name === 'Codex' ? 'codex' : 'claude'))
      head.push(line(member.telemetry.quotaError || quotaLines(member.telemetry.quotas ?? []).join(' | ')))
    }
  }
  const inner = Math.max(1, cols - 4)
  const displayText = state.secret ? '*'.repeat(graphemes(state.editor.text).length) : state.editor.text
  const before = graphemes(displayText).slice(0, state.editor.cursor).join('')
  const inputLines = wrap(displayText || `向 ${state.member ?? 'Codex'} 提问；/ 查看命令`, inner)
  const beforeLines = wrap(before, inner)
  const cursorLine = beforeLines.length - 1
  const visibleCount = Math.min(3, Math.max(1, height - head.length - 5))
  const firstInput = Math.max(0, cursorLine - visibleCount + 1)
  const shownInput = inputLines.slice(firstInput, firstInput + visibleCount)
  if (!shownInput.length) shownInput.push('')
  const bottom = [line(`╭─ ${state.promptTitle || state.member || 'Codex'} ${'─'.repeat(cols)}`, accent), ...shownInput.map((text, index) => line(`${index ? '│' : '>'} ${text}`, state.editor.text ? 'bright' : 'muted')), line('╰' + '─'.repeat(Math.max(0, cols - 1)), accent)]
  if (height >= 10) bottom.push(line('Enter 发送 · Alt+Enter 换行 · PgUp/Dn 滚动 · Ctrl+C 停止/退出'))
  const available = Math.max(0, height - head.length - bottom.length)
  let body: Line[] = []
  if (state.messages.length) {
    for (const message of state.messages) {
      body.push(line(`  ${message.role}`, message.role.startsWith('Codex') ? 'codex' : message.role.startsWith('Claude') ? 'claude' : 'muted'))
      body.push(...messageLines(message, Math.max(1, cols - 4)).map(text => line(`  ${text}`, message.role === 'Claude Code' || message.role === 'Codex' || message.role === '你' ? 'bright' : 'muted')))
      body.push(line())
    }
  } else if (cols >= 78 && available >= 10) {
    const logo = [
      ' █▀▀ █▀█ █▀▄▀█ █▀▄▀█ █▀█ █▄ █   █▀█ █▀█ █▀█ █▀▄▀█',
      ' █▄▄ █▄█ █ ▀ █ █ ▀ █ █▄█ █ ▀█   █▀▄ █▄█ █▄█ █ ▀ █',
      '', 'NATIVE AGENTS · SHARED WORKSPACE', '', '/to codex · /to claude · /to all',
    ]
    body = Array.from({ length: Math.max(1, Math.floor((available - logo.length) / 3)) }, () => line())
    body.push(...logo.map((text, index) => line(' '.repeat(Math.max(0, Math.floor((cols - width(text)) / 2))) + text, index < 2 ? 'bright' : 'muted')))
  } else body = [line('  COMMON ROOM', 'bright'), line('  / 查看命令；输入消息开始')]
  const menuStart = Math.max(0, (state.menuIndex ?? 0) - 6)
  const menu = state.menu.slice(menuStart, menuStart + Math.max(0, Math.min(8, available - 1))).map((text, index) => line(`${index + menuStart === (state.menuIndex ?? 0) ? '›' : ' '} ${text}`, accent))
  const contentHeight = Math.max(0, available - menu.length)
  const maxScroll = Math.max(0, body.length - contentHeight)
  const scroll = Math.min(state.scroll, maxScroll)
  body = body.slice(Math.max(0, body.length - contentHeight - scroll), Math.max(0, body.length - scroll))
  while (body.length < contentHeight) body.push(line())
  const lines = [...head, ...body, ...menu, ...bottom].slice(0, height)
  while (lines.length < height) lines.push(line())
  return { lines, cursor: { row: Math.min(height, head.length + available + 2 + cursorLine - firstInput), column: Math.min(cols, 3 + width(beforeLines.at(-1) ?? '')) }, maxScroll }
}
