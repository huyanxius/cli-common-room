import type { Telemetry } from '../room/telemetry.js'
import type { Editor } from './editor.js'
import { fit, wrap, width, graphemes } from './text.js'
import { toolSummary } from './tools.js'
import type { ToolActivity } from '../room/conversation.js'
import { quotaMeters } from './metrics.js'
export interface Message { role: string; text: string; tool?: ToolActivity }
export interface ScreenState {
  activity?: string; pickerTitle?: string; queue?: string[]; queuePaused?: boolean; expandTools?: boolean; tick?: number; member?: string; secret?: boolean; menuIndex?: number; members?: { name: string; telemetry: Telemetry }[]; telemetry: Telemetry; cwd: string; git: string; status: string; messages: Message[]
  editor: Editor; scroll: number; menu: string[]; promptTitle: string; seconds: number
}
export interface Line { text: string; tone: 'bright' | 'muted' | 'accent' | 'codex' | 'claude' | 'agy' }
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
  // 历史正文先不裁切补齐，滚动窗口切出可见行后再 fit：打字、滚轮每次都重绘，逐行 fit 全部历史会随会话长度线性变慢。
  const raw = (text = '', tone: Line['tone'] = 'muted'): Line => ({ text, tone })
  const accent = state.promptTitle.toLowerCase().startsWith('agy') || state.member === 'AGY' ? 'agy' : state.promptTitle.toLowerCase().startsWith('claude') || state.member === 'Claude Code' ? 'claude' : state.members ? 'accent' : 'codex'
  const activity = ['Connecting', 'Running', 'Stopping'].includes(state.status) ? `${['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][(state.tick ?? 0) % 10]} ` : ''
  const head = [line(`COMMON ROOM  /  ${activity}${state.status}${state.seconds ? ` ${state.seconds}s` : ''}  /  ${state.telemetry.model ?? '连接中'}`, 'bright')]
  if (height >= 18) {
    head.push(line(`  ${state.cwd}  ·  ${state.git}`))
    head.push(line('─'.repeat(cols)))
    const members = state.members ?? [{ name: state.member ?? 'Codex', telemetry: state.telemetry }]
    for (const member of members) {
      const value = member.telemetry
      const context = value.usage?.contextWindow ? ` · 上下文 ${Math.round(value.usage.last / value.usage.contextWindow * 100)}%` : ''
      const tokens = value.usage ? ` · ${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value.usage.total)} tokens` : ''
      head.push(line(`  ${member.name}  ${value.model ?? '尚未连接'}${value.effort ? ` · ${value.effort}` : ''}${context}${tokens}${value.billing ? ` · ${value.billing}` : ''}`, member.name === 'Claude Code' ? 'claude' : member.name === 'AGY' ? 'agy' : 'codex'))
      const meters = value.quotaError || quotaMeters(value.quotas ?? [], cols < 100 ? 4 : 8) || '订阅额度待检测 · /usage 刷新'
      const meterRows = wrap(meters, Math.max(1, cols - 4))
      head.push(...meterRows.slice(0, height >= 24 ? 2 : 1).map(text => line(`  ${text}`)))
    }
    head.push(line('─'.repeat(cols)))
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
  const title = fit(`─ ${state.pickerTitle || state.promptTitle || state.member || 'Codex'} `, Math.max(0, cols - 2)).trimEnd()
  const bottom = [line('╭' + title + '─'.repeat(Math.max(0, cols - 2 - width(title))) + '╮', accent), ...shownInput.map((text, index) => line(`${index ? '│' : '>'} ${fit(text, inner)} │`, state.editor.text ? 'bright' : 'muted')), line('╰' + '─'.repeat(Math.max(0, cols - 2)) + '╯', accent)]
  if (activity && height >= 15) bottom.unshift(line(`  ${activity}${state.activity || (state.status === 'Connecting' ? '连接原生 Agent' : state.status === 'Stopping' ? '正在停止' : '等待 Agent 输出')} · ${state.seconds}s · Esc 打断`, accent))
  if (state.queue?.length && height >= 15) bottom.unshift(line(`${state.queuePaused ? 'Ⅱ 队列暂停' : '↳ 排队'} · ${state.queue.length} 条 · ${state.queue[0]} · /queue drop 撤回`, 'bright'))
  if (height >= 10) bottom.push(line(`${state.scroll ? '↑ 阅读历史 · Ctrl+End 回到底部 · ' : ''}Enter ${state.status === 'Approval' || state.pickerTitle ? '确认选择' : state.status === 'Running' ? '排队' : '发送'} · @ 成员 · / 命令 · Esc 打断 · Ctrl+T 工具详情`))
  const available = Math.max(0, height - head.length - bottom.length)
  let body: Line[] = []
  if (state.messages.length) {
    for (const message of state.messages) {
      const tone = message.role.startsWith('Codex') ? 'codex' : message.role.startsWith('Claude') ? 'claude' : message.role.startsWith('AGY') ? 'agy' : 'muted'
      if (message.tool) {
        const tool = message.tool, summary = toolSummary(tool)
        const icon = tool.status === 'running' ? ['⠋', '⠙', '⠹', '⠸'][(state.tick ?? 0) % 4] : tool.status === 'completed' ? '✓' : tool.status === 'failed' ? '×' : tool.status === 'cancelled' ? '■' : '?'
        body.push(raw(`    ${icon} ${message.role} · ${summary.title}`, tone))
        const detail = wrap(summary.detail, Math.max(1, cols - 8))
        body.push(...(state.expandTools ? detail : detail.slice(0, 3)).map(text => raw(`      │ ${text}`)))
        if (!state.expandTools && detail.length > 3) body.push(raw(`      └ … ${detail.length - 3} 行已收起 · Ctrl+T 展开`))
        body.push(raw())
        continue
      }
      if (message.role === '你') {
        body.push(raw('  › 你', 'bright'))
        body.push(...messageLines(message, Math.max(1, cols - 6)).map(text => raw(`  │ ${text}`, 'bright')))

      } else {
        body.push(raw(`  ● ${message.role}`, tone))
        let code = false
        for (const text of messageLines(message, Math.max(1, cols - 6))) {
          if (text.startsWith('```')) { code = !code; body.push(raw(`    ${code ? '┌─ ' + text.slice(3) : '└─'}`)); continue }
          body.push(raw(`    ${code ? '│ ' : ''}${text}`, code || tone === 'muted' ? 'muted' : 'bright'))
        }
      }
      body.push(raw())
    }
  } else if (cols >= 78 && available >= 10) {
    const logo = [
      ' █▀▀ █▀█ █▀▄▀█ █▀▄▀█ █▀█ █▄ █   █▀█ █▀█ █▀█ █▀▄▀█',
      ' █▄▄ █▄█ █ ▀ █ █ ▀ █ █▄█ █ ▀█   █▀▄ █▄█ █▄█ █ ▀ █',
      '', 'NATIVE AGENTS · SHARED WORKSPACE', '', '@ 选择成员  ·  / 浏览命令  ·  /setup 配置登录',
    ]
    body = Array.from({ length: Math.max(1, Math.floor((available - logo.length) / 3)) }, () => raw())
    body.push(...logo.map((text, index) => raw(' '.repeat(Math.max(0, Math.floor((cols - width(text)) / 2))) + text, index < 2 ? 'bright' : 'muted')))
  } else body = [raw('  COMMON ROOM', 'bright'), raw('  / 查看命令；输入消息开始')]
  const menuStart = Math.max(0, (state.menuIndex ?? 0) - 6)
  const menu = state.menu.slice(menuStart, menuStart + Math.max(0, Math.min(8, available - 1))).map((text, index) => line(`${index + menuStart === (state.menuIndex ?? 0) ? '›' : ' '} ${text}`, accent))
  const contentHeight = Math.max(0, available - menu.length)
  const maxScroll = Math.max(0, body.length - contentHeight)
  const scroll = Math.min(state.scroll, maxScroll)
  body = body.slice(Math.max(0, body.length - contentHeight - scroll), Math.max(0, body.length - scroll)).map(item => line(item.text, item.tone))
  while (body.length < contentHeight) body.push(line())
  const lines = [...head, ...body, ...menu, ...bottom].slice(0, height)
  while (lines.length < height) lines.push(line())
  return { lines, cursor: { row: Math.min(height, head.length + available + bottom.findIndex(line => line.text.startsWith('╭')) + 2 + cursorLine - firstInput), column: Math.min(cols, 3 + width(beforeLines.at(-1) ?? '')) }, maxScroll }
}
