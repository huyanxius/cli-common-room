import { RoomArchive } from '../storage/archive.js'
import type { InteractionPrompt, SessionOptions, NativeCommand } from '../room/conversation.js'
import { ConversationRoom, type ConversationFactories } from '../room/live.js'
import type { MemberId } from '../room/context.js'
import type { Telemetry } from '../room/telemetry.js'
import { workspaceStatus, workspaceDiff } from '../runtime/workspace.js'
import { emptyEditor, edit } from './editor.js'
import { clean, graphemes } from './text.js'
import { renderScreen, type ScreenState, type Message, type Line } from './screen.js'
import { commands, matchingCommands } from './commands.js'
import { TerminalInput } from './input.js'
import { quotaLines, tokenLine } from './metrics.js'

export async function terminalWorkspace(factories: ConversationFactories): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('聊天需要交互终端')
  const state: ScreenState = { telemetry: {}, cwd: process.cwd(), git: '读取工作树…', status: 'Connecting', messages: [], editor: emptyEditor(), scroll: 0, menu: [], promptTitle: '', seconds: 0 }
  let menuIndex = 0
  let selected: MemberId | 'all' = 'codex'
  const telemetry: Record<MemberId, Telemetry> = { codex: {}, claude: {} }
  const catalogs: Record<MemberId, NativeCommand[]> = { codex: [], claude: [] }
  let archive = new RoomArchive(state.cwd)
  let room: ConversationRoom
  let busy = false, stopping = false, suspended = false, finished = false, ready = false
  let previous: Line[] = [], currentReply: Message | undefined, started = 0
  let interaction: { prompt: InteractionPrompt; resolve(value: string): void; reject(error: Error): void; dispose(): void } | undefined
  let savedEditor = emptyEditor()
  let resolveExit!: () => void
  const exited = new Promise<void>(resolve => { resolveExit = resolve })
  let cancelTimer: ReturnType<typeof setTimeout> | undefined
  let scheduled: ReturnType<typeof setTimeout> | undefined
  const colors = { bright: '\x1b[0;39;49m', muted: '\x1b[0;2;39;49m', accent: '\x1b[0;39;49m', codex: '\x1b[0;38;5;141m', claude: '\x1b[0;38;5;173m' }
  const draw = (): void => {
    if (suspended || finished) return
    state.menuIndex = menuIndex
    if (selected === 'all') state.members = [{ name: 'Codex', telemetry: telemetry.codex }, { name: 'Claude Code', telemetry: telemetry.claude }]
    else delete state.members
    state.menu = interaction ? [] : matchingCommands(state.editor.text, selected === 'all' ? [] : catalogs[selected])
    state.seconds = busy && started ? Math.floor((Date.now() - started) / 1000) : 0
    const frame = renderScreen(state, process.stdout.columns || 80, process.stdout.rows || 24)
    state.scroll = Math.min(state.scroll, frame.maxScroll)
    let output = '\x1b[?25l'
    frame.lines.forEach((line, i) => {
      if (previous[i]?.text !== line.text || previous[i]?.tone !== line.tone) output += `\x1b[${i + 1};1H${colors[line.tone]}${line.text}\x1b[K`
    })
    previous = frame.lines
    output += `\x1b[${frame.cursor.row};${frame.cursor.column}H\x1b[?25h`
    process.stdout.write(output)
  }
  const redraw = (): void => { if (!scheduled) scheduled = setTimeout(() => { scheduled = undefined; draw() }, 25) }
  const note = (text: string): void => { state.messages.push({ role: 'Common Room', text: clean(text) }); redraw() }
  const enterScreen = (): void => {
    process.stdin.setRawMode(true); process.stdin.resume()
    process.stdout.write('\x1b[?1049h\x1b[?2004h\x1b[2J')
    previous = []; suspended = false; draw()
  }
  const leaveScreen = (): void => {
    suspended = true
    process.stdout.write('\x1b[?2004l\x1b[0m\x1b[?25h\x1b[?1049l')
    process.stdin.setRawMode(false)
  }
  const stop = async (): Promise<void> => {
    if (finished) return
    finished = true; ready = false
    interaction?.dispose(); interaction?.reject(new Error('终端已退出')); interaction = undefined
    clearTimeout(cancelTimer); clearTimeout(scheduled)
    try { await room.close() } finally { resolveExit() }
  }
  const interact = async (prompt: InteractionPrompt): Promise<string> => {
    if (prompt.signal.aborted) throw new Error('交互已过期')
    if (interaction) throw new Error('尚有未处理交互')
    state.secret = prompt.kind === 'question' && prompt.secret
    savedEditor = state.editor; state.editor = emptyEditor()
    state.status = 'Approval'; state.promptTitle = prompt.title
    const choices = prompt.kind === 'approval' ? prompt.choices.map((choice, i) => `${i + 1}. ${choice.label}`) : prompt.options.map((choice, i) => `${i + 1}. ${choice.label} — ${choice.description}`)
    state.messages.push({ role: prompt.title, text: `${prompt.details}\n\n${choices.join('\n')}\n${prompt.kind === 'question' && (prompt.allowOther || !prompt.options.length) ? '输入编号或自填答案' : '输入编号确认；没有默认选择'}` })
    state.scroll = 0; redraw()
    try {
      return await new Promise<string>((resolve, reject) => {
        const abort = (): void => { interaction = undefined; reject(new Error('交互已过期')) }
        prompt.signal.addEventListener('abort', abort, { once: true })
        interaction = { prompt, resolve, reject, dispose: () => prompt.signal.removeEventListener('abort', abort) }
      })
    } finally {
      interaction = undefined
      state.secret = false; state.editor = savedEditor; state.promptTitle = ''; state.status = stopping ? 'Stopping' : 'Running'; redraw()
    }
  }
  const options = (member: MemberId): SessionOptions => ({
    cwd: state.cwd,
    interact: prompt => interact({ ...prompt, title: `${member} · ${prompt.title}` }),
    onDisconnect: () => { if (selected === member) { ready = false; state.status = 'Disconnected'; redraw() } },
    onCommands: commands => { catalogs[member] = commands; redraw() },
    onTelemetry: update => {
      telemetry[member] = { ...telemetry[member], ...update }
      if (selected === member) state.telemetry = telemetry[member]
      else if (selected === 'all') state.telemetry = { model: `${telemetry.codex.model ?? '—'} + ${telemetry.claude.model ?? '—'}` }
      redraw()
    },
    onEvent: event => {
      const label = member === 'claude' ? 'Claude Code' : 'Codex'
      if (event.type === 'text') {
        if (!currentReply || currentReply.role !== label) { currentReply = { role: label, text: '' }; state.messages.push(currentReply) }
        currentReply.text += event.text
      } else {
        let text = event.text
        if (event.type === 'tool') {
          const start = text.indexOf('{')
          try { const tool = JSON.parse(text.slice(start)) as Record<string, unknown>; if (tool.type) text = `${text.slice(0, start)}${tool.type} · ${tool.command ?? tool.status ?? ''}` } catch { /* 未识别结构按普通文本处理。 */ }
        }
        state.messages.push({ role: `${label} · ${event.type === 'tool' ? '工具' : '通知'}`, text }); currentReply = undefined
      }
      redraw()
    },
  })
  room = new ConversationRoom(factories, options, snapshot => archive.save(snapshot))
  const select = async (member: MemberId | 'all'): Promise<void> => {
    ready = false; state.status = 'Connecting'; redraw()
    const recipients: MemberId[] = member === 'all' ? ['codex', 'claude'] : [member]
    for (const recipient of recipients) await room.connect(recipient)
    selected = member; state.member = member === 'all' ? 'Codex + Claude Code' : member === 'claude' ? 'Claude Code' : 'Codex'
    state.telemetry = member === 'all' ? { model: `${telemetry.codex.model ?? '—'} + ${telemetry.claude.model ?? '—'}` } : telemetry[member]
    ready = true; state.status = 'Ready'; redraw()
    for (const recipient of recipients) {
      try { await room.command(recipient, 'usage', '') } catch { telemetry[recipient].quotaError = '订阅额度不可用 · /usage 重试' }
      try { await room.command(recipient, 'skills', '') } catch { /* 目录不可用时保留已验证的内置命令。 */ }
    }
    redraw()
  }
  const submit = async (text: string): Promise<void> => {
    if (interaction) {
      const target = interaction
      if (target.prompt.signal.aborted) return
      const index = /^\d+$/.test(text.trim()) ? Number(text.trim()) - 1 : -1
      const answer = target.prompt.kind === 'approval' ? target.prompt.choices[index]?.id : target.prompt.options[index]?.label ?? (target.prompt.allowOther || !target.prompt.options.length ? text : undefined)
      if (!answer) { note('请选择有效编号。'); return }
      target.dispose(); interaction = undefined; target.resolve(answer); return
    }
    if (busy || (!ready && !['/new', '/exit', '/quit'].includes(text) && !text.startsWith('/to '))) { state.editor = { ...state.editor, text, cursor: graphemes(text).length }; note('当前操作尚未结束，输入已保留。'); return }
    if (text === '/exit' || text === '/quit') { await stop(); return }
    busy = true; started = Date.now(); state.status = 'Running'; state.scroll = 0; currentReply = undefined; redraw()
    try {
      if (text.startsWith('/')) {
        const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text)
        const name = match?.[1] ?? 'help', argument = match?.[2]?.trim() ?? ''
        if (name === 'help') note(commands.map(([command, detail]) => `/${command}  ${detail}`).join('\n') + '\n/to codex|claude|all 选择接收者。命令只作用于当前单个成员。Claude 命令目录由原生动态提供。')
        else if (name === 'diff') note(await workspaceDiff(state.cwd))
        else if (name === 'screen-clear') state.messages = []
        else if (name === 'status') note([state.cwd, state.git, ...(['codex', 'claude'] as const).flatMap(member => [member, `thread ${telemetry[member].threadId ?? '未连接'}`, `model ${telemetry[member].model ?? '未报告'}`, tokenLine(telemetry[member].usage), ...quotaLines(telemetry[member].quotas ?? [])])].join('\n'))
        else if (name === 'to') {
          if (!['codex', 'claude', 'all'].includes(argument)) throw new Error('用法：/to codex|claude|all')
          await select(argument as MemberId | 'all')
        }
        else if (name === 'new' || name === 'clear') { await room.close(); await archive.release(); archive = new RoomArchive(state.cwd); room = new ConversationRoom(factories, options, snapshot => archive.save(snapshot)); telemetry.codex = {}; telemetry.claude = {}; state.telemetry = {}; state.messages = []; await select(selected) }
        else if (name === 'resume') {
          if (!argument) note((await archive.list()).map(item => `${item.id} · ${item.updatedAt} · ${item.count} 条消息`).join('\n') || '当前工作区没有已保存房间')
          else {
            if (argument === archive.id) throw new Error('当前已在此房间')
            const restored = new RoomArchive(state.cwd)
            const snapshot = await restored.load(argument)
            await room.close(); await archive.release(); archive = restored
            telemetry.codex = {}; telemetry.claude = {}
            room = new ConversationRoom(factories, options, value => archive.save(value), snapshot)
            state.messages = snapshot.history.map(message => ({ role: message.author === 'user' ? '你' : message.author === 'claude' ? 'Claude Code' : 'Codex', text: message.text }))
            await select(selected)
            note(snapshot.uncertain.length ? '存在交付状态未知的成员，已阻止自动重发。/new 可开始新的房间。' : '房间已恢复，原生上下文与交付位置沿用存档。')
          }
        }
        else {
          if (selected === 'all') throw new Error('命令需要明确成员，请先 /to codex 或 /to claude')
          note(await room.command(selected, name, argument))
          if (name === 'usage') note(quotaLines(state.telemetry.quotas ?? []).join('\n'))
        }
      } else {
        state.messages.push({ role: '你', text })
        const results = await room.send(selected === 'all' ? ['codex', 'claude'] : [selected], text)
        for (const { member, result, error } of results) {
          if (error) note(`${member}: ${error}`)
          else if (result?.status !== 'completed') note(`${member}: ${result?.status === 'cancelled' ? '已停止；已执行操作不会回滚' : '轮次失败，保留部分内容'}`)
        }
      }
    } catch (error) { note(error instanceof Error ? error.message : '操作失败') }
    finally {
      busy = false; stopping = false; clearTimeout(cancelTimer); currentReply = undefined
      state.status = ready ? 'Ready' : 'Disconnected'
      state.git = await workspaceStatus(state.cwd); redraw()
    }
  }
  const cancel = (): void => {
    if (!busy || stopping) { void stop(); return }
    stopping = true; state.status = 'Stopping'; redraw()
    cancelTimer = setTimeout(() => { note('停止未获确认，连接关闭，执行结果未知。'); void stop() }, 5000)
    void room.cancel().catch(error => { note(String(error)); void stop() })
  }
  const input = new TerminalInput((text, key) => {
    if (suspended || finished) return
    if (key.ctrl && key.name === 'c') { cancel(); return }
    if (key.ctrl && key.name === 'd' && !state.editor.text) { void stop(); return }
    if (key.name === 'pageup' || key.name === 'pagedown') { state.scroll = Math.max(0, state.scroll + (key.name === 'pageup' ? 10 : -10)); redraw(); return }
    const matches = interaction ? [] : matchingCommands(state.editor.text, selected === 'all' ? [] : catalogs[selected])
    if (matches.length && (key.name === 'up' || key.name === 'down')) {
      menuIndex = (menuIndex + (key.name === 'down' ? 1 : -1) + matches.length) % matches.length; redraw(); return
    }
    if ((key.name === 'tab' || (key.name === 'return' && state.editor.text === '/')) && !interaction) {
      const first = matchingCommands(state.editor.text, selected === 'all' ? [] : catalogs[selected])[menuIndex]?.split('  ')[0]
      if (first) state.editor = { ...state.editor, text: first + ' ', cursor: graphemes(first).length + 1 }
      menuIndex = 0; redraw(); return
    }
    menuIndex = 0
    const result = edit(state.editor, { name: key.name ?? '', ...(text ? { text } : {}), ctrl: !!key.ctrl, meta: !!key.meta, shift: !!key.shift })
    state.editor = result.state
    if (result.submit !== undefined) void submit(result.submit)
    redraw()
  }, text => { state.editor = edit(state.editor, { name: 'paste', text: text.replace(/\r\n?/g, '\n') }).state; redraw() })
  const data = (chunk: string): void => input.feed(chunk)
  const resize = (): void => { previous = []; redraw() }
  const signal = (): void => { void stop() }
  const timer = setInterval(redraw, 1000)
  process.stdin.setEncoding('utf8'); process.stdin.on('data', data)
  process.stdout.on('resize', resize); process.on('SIGTERM', signal); process.on('SIGHUP', signal)
  enterScreen()
  try {
    state.git = await workspaceStatus(state.cwd)
    await select('codex')
    await exited
  } finally {
    finished = true; clearInterval(timer); clearTimeout(scheduled); clearTimeout(cancelTimer)
    interaction?.dispose(); interaction?.reject(new Error('终端已退出'))
    try { await room.close(); await archive.release() } finally {
    process.stdin.off('data', data); process.stdout.off('resize', resize)
    process.off('SIGTERM', signal); process.off('SIGHUP', signal)
    input.close(); leaveScreen(); process.stdin.pause()
    }
  }
}
