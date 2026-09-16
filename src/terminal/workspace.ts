import { MessageQueue, parseRecipient, type Recipient } from './queue.js'
import { authenticationEnv, inspectNative, loginNative, type NativeLogin } from '../runtime/native-auth.js'
import { SetupPreferences, type SetupSettings } from '../storage/setup.js'
import { createSetup, renderSetup, setupActions } from './setup.js'
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

export async function terminalWorkspace(factories: ConversationFactories, configuration?: { settings: SetupSettings; store: SetupPreferences; force?: boolean }): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('聊天需要交互终端')
  const state: ScreenState = { telemetry: {}, cwd: process.cwd(), git: '读取工作树…', status: 'Connecting', messages: [], editor: emptyEditor(), scroll: 0, menu: [], promptTitle: '', seconds: 0 }
  const setup = createSetup()
  if (configuration) { setup.binaries = configuration.settings.binaries; setup.authSource = configuration.settings.authSource ?? 'native' }
  let showingSetup = !!configuration, setupGeneration = 0, connectionsChanged = false, setupConnecting = false
  let login: NativeLogin | undefined
  let interactionIndex = -1
  let picker: { name: 'model' | 'effort' | 'queue'; member: MemberId; choices: import('../room/conversation.js').CommandChoice[]; index: number } | undefined
  let tick = 0
  const queue = new MessageQueue()
  let menuIndex = 0
  let selected: MemberId | 'all' = 'codex'
  const telemetry: Record<MemberId, Telemetry> = { codex: {}, claude: {} }
  const usageChecked: Record<MemberId, number> = { codex: 0, claude: 0 }
  const catalogs: Record<MemberId, NativeCommand[]> = { codex: [], claude: [] }
  let archive = new RoomArchive(state.cwd)
  let room: ConversationRoom
  let busy = false, stopping = false, suspended = false, finished = false, ready = false
  let lastMaxScroll = 0
  let previous: Line[] = [], currentReply: Message | undefined, started = 0
  let interaction: { prompt: InteractionPrompt; resolve(value: string): void; reject(error: Error): void; dispose(): void } | undefined
  let savedEditor = emptyEditor()
  let resolveExit!: () => void
  const exited = new Promise<void>(resolve => { resolveExit = resolve })
  let cancelTimer: ReturnType<typeof setTimeout> | undefined
  let scheduled: ReturnType<typeof setTimeout> | undefined
  const colors = { bright: '\x1b[0;39;49m', muted: '\x1b[0;2;39;49m', accent: '\x1b[0;39;49m', codex: '\x1b[0;38;5;141m', claude: '\x1b[0;38;5;173m' }
  const inputMenu = (): string[] => state.editor.text.startsWith('@') && !state.editor.text.includes(' ') ? ['@all  双方', '@codex  Codex', '@claude  Claude Code'].filter(item => item.startsWith(state.editor.text)) : matchingCommands(state.editor.text, selected === 'all' ? [] : catalogs[selected])
  const draw = (): void => {
    if (suspended || finished) return
    state.menuIndex = menuIndex
    if (selected === 'all') state.members = [{ name: 'Codex', telemetry: telemetry.codex }, { name: 'Claude Code', telemetry: telemetry.claude }]
    else delete state.members
    state.menu = interaction ? (interaction.prompt.kind === 'approval' ? interaction.prompt.choices.map(item => item.label) : interaction.prompt.options.map(item => `${item.label}  ${item.description}`)) : picker ? picker.choices.map(choice => `${choice.current ? '●' : '○'} ${choice.label}  ${choice.description}`) : inputMenu()
    if (interaction) state.menuIndex = interactionIndex
    if (picker) state.menuIndex = picker.index
    state.pickerTitle = picker ? `${picker.member} · 选择${picker.name === 'model' ? '模型' : picker.name === 'queue' ? '队列操作' : '思考强度'} · ↑↓ Enter 确认 · Esc 返回` : ''
    state.queue = queue.items.map(item => `@${item.recipient}  ${item.text.replace(/\n/g, ' ')}`); state.queuePaused = queue.paused
    state.seconds = busy && started ? Math.floor((Date.now() - started) / 1000) : 0
    state.tick = tick
    const frame = showingSetup ? renderSetup(setup, process.stdout.columns || 80, process.stdout.rows || 24, tick) : renderScreen(state, process.stdout.columns || 80, process.stdout.rows || 24)
    if (!showingSetup && state.scroll > 0 && frame.maxScroll > lastMaxScroll) { state.scroll += frame.maxScroll - lastMaxScroll; const stable = renderScreen(state, process.stdout.columns || 80, process.stdout.rows || 24); frame.lines = stable.lines; frame.cursor = stable.cursor }
    lastMaxScroll = frame.maxScroll
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
    process.stdout.write('\x1b[?1049h\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[2J')
    previous = []; suspended = false; draw()
  }
  const leaveScreen = (): void => {
    suspended = true
    process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[0m\x1b[?25h\x1b[?1049l')
    process.stdin.setRawMode(false)
  }
  const stop = async (): Promise<void> => {
    if (finished) return
    finished = true; ready = false; setupGeneration++; login?.cancel()
    interaction?.dispose(); interaction?.reject(new Error('终端已退出')); interaction = undefined
    clearTimeout(cancelTimer); clearTimeout(scheduled)
    try { await room.close() } finally { resolveExit() }
  }
  const interact = async (prompt: InteractionPrompt): Promise<string> => {
    if (prompt.signal.aborted) throw new Error('交互已过期')
    if (interaction) throw new Error('尚有未处理交互')
    state.secret = prompt.kind === 'question' && prompt.secret
    savedEditor = state.editor; state.editor = emptyEditor()
    state.status = 'Approval'; state.promptTitle = prompt.title; interactionIndex = -1
    state.messages.push({ role: prompt.title, text: `${prompt.details}\n\n↑↓ 选择、Enter 确认；也可输入编号。Esc 打断；不会默认授权。` })
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
    ...(member === 'claude' ? { env: authenticationEnv(setup.authSource) } : {}),
    interact: prompt => interact(prompt),
    onDisconnect: () => { if (finished || connectionsChanged) return; if (selected === member || selected === 'all') { ready = false; connectionsChanged = true; state.status = 'Disconnected'; redraw() } },
    onCommands: commands => { catalogs[member] = commands; redraw() },
    onTelemetry: update => {
      telemetry[member] = { ...telemetry[member], ...update }
      if (selected === member) state.telemetry = telemetry[member]
      else if (selected === 'all') state.telemetry = { model: `${telemetry.codex.model ?? '—'} + ${telemetry.claude.model ?? '—'}` }
      redraw()
    },
    onEvent: event => {
      const label = member === 'claude' ? 'Claude Code' : 'Codex'
      state.activity = event.type === 'tool' ? `${label} · 执行 ${event.tool?.name || '工具'}` : `${label} · 正在回复`
      if (event.type === 'text') {
        if (!currentReply || currentReply.role !== label) { currentReply = { role: label, text: '' }; state.messages.push(currentReply) }
        currentReply.text += event.text
      } else if (event.type === 'tool' && event.tool) {
        const tool = event.tool
        const existing = state.messages.find(message => message.role === label && message.tool?.id === tool.id)
        if (existing?.tool) existing.tool = { ...existing.tool, ...tool, name: tool.name || existing.tool.name, input: tool.input ?? existing.tool.input }
        else state.messages.push({ role: label, text: '', tool })
        currentReply = undefined
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
      try { await room.command(recipient, 'usage', ''); usageChecked[recipient] = Date.now() } catch { telemetry[recipient].quotaError = '订阅额度不可用 · /usage 重试' }
      try { await room.command(recipient, 'skills', '') } catch { /* 目录不可用时保留已验证的内置命令。 */ }
    }
    redraw()
  }
  const refreshSetup = async (): Promise<void> => {
    const generation = ++setupGeneration
    setup.pending = true; setup.status = '检测本机程序与登录状态…'; setup.index = 0; redraw()
    const members: MemberId[] = setup.view === 'welcome' ? ['codex', 'claude'] : [setup.view]
    try {
      await Promise.all(members.map(async member => {
        const result = await inspectNative(member, setup.binaries[member], { cwd: state.cwd, ...(member === 'claude' ? { env: authenticationEnv(setup.authSource) } : {}) })
        if (generation === setupGeneration && !finished) setup.members[member] = result
      }))
      if (generation === setupGeneration) setup.status = '检测完成。选择成员登录，或使用现有配置进入。'
    } finally { if (generation === setupGeneration) setup.pending = false; redraw() }
  }
  const openSetup = (member?: MemberId): void => {
    showingSetup = true; setup.view = member ?? 'welcome'; setup.index = 0; setup.editing = undefined; setup.input = ''; setup.output = ''; redraw()
    void refreshSetup()
  }
  const setupAction = async (id: string): Promise<void> => {
    try {
      if (id === 'cancel') { ++setupGeneration; login?.cancel(); if (setupConnecting) { connectionsChanged = true; ready = false; await room.close() }; if (!login) { setup.pending = false; setup.status = '检测已取消' }; return }
      if (setup.pending) return
      if (id === 'back') { setup.editing = undefined; setup.input = ''; setup.view = 'welcome'; setup.output = ''; setup.index = 0; return }
      if (id === 'close') { if (ready) showingSetup = false; else await stop(); return }
      if (id === 'codex' || id === 'claude') { setup.view = id; setup.index = 0; setup.output = ''; return }
      if (id === 'refresh') { await refreshSetup(); return }
      if (id === 'source') { setup.authSource = setup.authSource === 'inherit' ? 'native' : 'inherit'; connectionsChanged = true; await refreshSetup(); return }
      if (id === 'path' && setup.view !== 'welcome') { setup.editing = 'path'; setup.input = setup.binaries[setup.view]; setup.index = 0; return }
      if (id === 'save-path' && setup.view !== 'welcome') {
        const path = setup.input.trim()
        if (!path || /[\x00-\x1f\x7f]/.test(path)) throw new Error('请输入有效程序路径')
        setup.binaries[setup.view] = path; connectionsChanged = true; setup.editing = undefined; setup.input = ''; await refreshSetup(); return
      }
      if ((id === 'login' || id === 'alternate') && setup.view !== 'welcome') {
        const member = setup.view
        if (member === 'claude') setup.authSource = 'native'
        setup.pending = true; setup.index = 0; setup.editing = 'code'; setup.input = ''; setup.output = ''
        setup.status = '等待浏览器授权 · Esc 取消 · 原生要求验证码时可在下方输入'
        connectionsChanged = true
        login = loginNative(member, setup.binaries[member], { cwd: state.cwd, ...(member === 'claude' ? { env: authenticationEnv(setup.authSource) } : {}), method: id === 'login' ? 'browser' : member === 'codex' ? 'device' : 'console', onOutput: text => { setup.output = text; redraw() } })
        redraw()
        try { await login.done; setup.members[member] = await inspectNative(member, setup.binaries[member], { cwd: state.cwd, ...(member === 'claude' ? { env: authenticationEnv(setup.authSource) } : {}) }); setup.status = setup.members[member]?.auth === 'signed-in' ? '原生登录完成。选择进入工作区后重新连接。' : '登录程序已结束，但认证尚未确认；请重新检测。' }
        finally { login = undefined; setup.pending = false; setup.editing = undefined; setup.input = ''; setup.index = 0 }
        return
      }
      if (id === 'all' || id.startsWith('use-')) {
        const member = id === 'all' ? 'all' : id.slice(4) as MemberId
        const members: MemberId[] = member === 'all' ? ['codex', 'claude'] : [member]
        if (members.some(value => setup.members[value]?.installed === false)) throw new Error('所选成员程序不可用，请先配置路径')
        const generation = ++setupGeneration
        setup.pending = true; setupConnecting = true; setup.status = '连接原生会话…'; redraw()
        try {
          if (connectionsChanged) {
            const snapshot = room.snapshot(); await room.close()
            room = new ConversationRoom(factories, options, value => archive.save(value), snapshot)
            telemetry.codex = {}; telemetry.claude = {}; connectionsChanged = false
          }
          await select(member)
          if (generation !== setupGeneration || finished) return
          if (configuration) await configuration.store.save({ completed: true, selected: member, binaries: setup.binaries, authSource: setup.authSource })
          showingSetup = false; setup.output = ''
        } finally { setup.pending = false; setupConnecting = false }
      }
    } catch (error) { setup.status = error instanceof Error ? error.message : '操作失败'; setup.index = 0 }
    finally { redraw() }
  }
  const submit = async (text: string, recipientOverride?: Recipient): Promise<void> => {
    if (interaction) {
      const target = interaction
      if (target.prompt.signal.aborted) return
      const index = /^\d+$/.test(text.trim()) ? Number(text.trim()) - 1 : -1
      const answer = target.prompt.kind === 'approval' ? target.prompt.choices[index]?.id : target.prompt.options[index]?.label ?? (target.prompt.allowOther || !target.prompt.options.length ? text : undefined)
      if (!answer) { note('请选择有效编号。'); return }
      target.dispose(); interaction = undefined; target.resolve(answer); return
    }
    const routed = parseRecipient(text, recipientOverride ?? selected)
    if (text.startsWith('@') && routed.text !== text) {
      text = routed.text
      if (!text) { if (busy) { selected = routed.recipient; state.member = selected === 'all' ? 'Codex + Claude Code' : selected === 'claude' ? 'Claude Code' : 'Codex'; redraw() } else { busy = true; try { await select(routed.recipient) } catch (error) { note(String(error)) } finally { busy = false; redraw() } }; return }
    }
    if (text === '/queue clear') { queue.clear(); redraw(); return }
    if (text === '/queue drop') { const item = queue.withdraw(); if (item) state.editor = { ...emptyEditor(), text: `@${item.recipient} ${item.text}`, cursor: graphemes(`@${item.recipient} ${item.text}`).length }; redraw(); return }
    if (text === '/queue resume') { queue.resume(); if (!busy) { const item = queue.take(); if (item) void submit(item.text, item.recipient) }; redraw(); return }
    if (text === '/queue') { picker = { name: 'queue', member: selected === 'all' ? 'codex' : selected, index: 0, choices: [{ value: 'resume', label: '继续队列', description: `${queue.items.length} 条消息` }, { value: 'drop', label: '撤回最后一条到输入框', description: '' }, { value: 'clear', label: '清空队列', description: '' }] }; redraw(); return }
    if (!busy && !queue.items.length) queue.resume()
    if (busy && !text.startsWith('/')) {
      try { queue.add(text, routed.recipient) } catch (error) { state.editor = { ...state.editor, text, cursor: graphemes(text).length }; note(String(error)) }
      redraw(); return
    }
    if (busy || (!ready && !['/new', '/exit', '/quit', '/setup', '/login'].includes(text) && !text.startsWith('/login ') && !text.startsWith('/to '))) { state.editor = { ...state.editor, text, cursor: graphemes(text).length }; note('当前操作尚未结束，输入已保留。'); return }
    if (text === '/exit' || text === '/quit') { await stop(); return }
    busy = true; started = Date.now(); state.activity = ''; state.status = 'Running'; state.scroll = 0; currentReply = undefined; redraw()
    try {
      if (text.startsWith('/')) {
        const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text)
        const name = match?.[1] ?? 'help', argument = match?.[2]?.trim() ?? ''
        if (name === 'setup' || name === 'login') { if (!configuration) throw new Error('当前入口未配置登录服务'); if (argument && !['codex', 'claude'].includes(argument)) throw new Error('用法：/login codex|claude'); openSetup(name === 'login' ? (argument || (selected === 'all' ? 'claude' : selected)) as MemberId : undefined) }
        else if (name === 'help') note(commands.map(([command, detail]) => `/${command}  ${detail}`).join('\n') + '\n/to codex|claude|all 选择接收者。命令只作用于当前单个成员。Claude 命令目录由原生动态提供。')
        else if ((name === 'model' || name === 'effort') && !argument) {
          if (selected === 'all') throw new Error('先用 @ 选择要设置的成员')
          const choices = await room.choices(selected, name)
          if (!choices.length) throw new Error('当前原生模型未提供可选项')
          picker = { name, member: selected, choices, index: Math.max(0, choices.findIndex(choice => choice.current)) }
        }
        else if (name === 'diff') note(await workspaceDiff(state.cwd))
        else if (name === 'screen-clear') state.messages = []
        else if (name === 'status') note([state.cwd, state.git, ...(['codex', 'claude'] as const).flatMap(member => [member, `thread ${telemetry[member].threadId ?? '未连接'}`, `model ${telemetry[member].model ?? '未报告'}`, `程序 ${telemetry[member].executable ?? setup.binaries[member]}`, `配置目录 ${telemetry[member].configDirectory ?? '原生默认'}`, `认证选择 ${member === 'claude' ? setup.authSource === 'native' ? '本机登录' : '沿用启动环境' : '原生配置'} · 原生来源 ${telemetry[member].authSource ?? '未报告'} · ${telemetry[member].billing ?? '计费状态未报告'}`,  tokenLine(telemetry[member].usage), ...quotaLines(telemetry[member].quotas ?? [])])].join('\n'))
        else if (name === 'to') {
          if (!['codex', 'claude', 'all'].includes(argument)) throw new Error('用法：/to codex|claude|all')
          await select(argument as MemberId | 'all')
        }
        else if (name === 'new' || name === 'clear') { queue.pause(); await room.close(); await archive.release(); archive = new RoomArchive(state.cwd); room = new ConversationRoom(factories, options, snapshot => archive.save(snapshot)); telemetry.codex = {}; telemetry.claude = {}; state.telemetry = {}; state.messages = []; await select(selected) }
        else if (name === 'resume') {
          if (!argument) note((await archive.list()).map(item => `${item.id} · ${item.updatedAt} · ${item.count} 条消息`).join('\n') || '当前工作区没有已保存房间')
          else {
            if (argument === archive.id) throw new Error('当前已在此房间')
            queue.pause()
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
        if (routed.recipient !== selected) { await select(routed.recipient); state.status = 'Running' }
        state.messages.push({ role: '你', text })
        const results = await room.send(routed.recipient === 'all' ? ['codex', 'claude'] : [routed.recipient], text)
        for (const { member, result, error } of results) {
          if (error) { queue.pause(); note(`${member}: ${error}`) }
          else if (result?.status !== 'completed') { queue.pause(); note(`${member}: ${result?.status === 'cancelled' ? '已停止；已执行操作不会回滚' : '轮次失败，保留部分内容'}`) }
          if (!error && Date.now() - usageChecked[member] >= 30000) { try { await room.command(member, 'usage', ''); usageChecked[member] = Date.now() } catch { telemetry[member].quotaError = '额度刷新失败 · /usage 重试' } }
        }
      }
    } catch (error) { if (!text.startsWith('/')) queue.pause(); note(error instanceof Error ? error.message : '操作失败') }
    finally {
      busy = false; clearTimeout(cancelTimer); currentReply = undefined
      for (const message of state.messages) if (message.tool?.status === 'running') message.tool.status = stopping ? 'cancelled' : 'unknown'
      state.status = ready ? 'Ready' : 'Disconnected'; stopping = false
      state.git = await workspaceStatus(state.cwd); redraw()
      if (!finished && !showingSetup && !picker && ready && !queue.paused) { const next = queue.take(); if (next) setImmediate(() => { void submit(next.text, next.recipient) }) }
    }
  }
  const cancel = (): void => {
    queue.pause()
    if (!busy) { redraw(); return }
    if (stopping) return
    stopping = true; state.status = 'Stopping'; if (interaction?.prompt.kind === 'approval') { const target = interaction; target.dispose(); interaction = undefined; target.resolve('cancel') }; redraw()
    cancelTimer = setTimeout(() => { ready = false; note('停止未获确认，原生连接关闭；执行结果未知。/setup 可重新连接。'); connectionsChanged = true; void room.close() }, 5000)
    void room.cancel().catch(error => { note(String(error)); ready = false; connectionsChanged = true; void room.close() })
  }
  const input = new TerminalInput((text, key) => {
    if (suspended || finished) return
    if (showingSetup) {
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { void setupAction(setup.pending ? 'cancel' : setup.view !== 'welcome' || setup.editing ? 'back' : 'close'); return }
      if (setup.editing) {
        if (key.name === 'return') { if (setup.editing === 'code') { login?.send(setup.input); setup.input = '' } else void setupAction('save-path') }
        else { const value = edit({ ...emptyEditor(), text: setup.input, cursor: graphemes(setup.input).length }, { name: key.name ?? '', ...(text ? { text } : {}), ctrl: !!key.ctrl }); setup.input = value.state.text }
      } else if (key.name === 'up' || key.name === 'down') setup.index = (setup.index + (key.name === 'down' ? 1 : -1) + setupActions(setup).length) % setupActions(setup).length
      else if (key.name === 'return') void setupAction(setupActions(setup)[setup.index]?.id ?? 'back')
      redraw(); return
    }
    if (interaction && (key.name === 'up' || key.name === 'down')) {
      const count = interaction.prompt.kind === 'approval' ? interaction.prompt.choices.length : interaction.prompt.options.length
      if (count) interactionIndex = interactionIndex < 0 ? (key.name === 'down' ? 0 : count - 1) : (interactionIndex + (key.name === 'down' ? 1 : -1) + count) % count
      redraw(); return
    }
    if (interaction && key.name === 'return' && !state.editor.text.trim()) {
      if (interactionIndex >= 0) void submit(String(interactionIndex + 1))
      else note('请先用 ↑↓ 选择，或输入编号；没有默认授权。')
      return
    }
    if (picker) {
      if (key.ctrl && key.name === 'c') { picker = undefined; if (busy) cancel(); else void stop(); return }
      if (key.name === 'escape') { picker = undefined; redraw(); return }
      if (busy && picker.name !== 'queue') return
      if (key.name === 'up' || key.name === 'down') picker.index = (picker.index + (key.name === 'down' ? 1 : -1) + picker.choices.length) % picker.choices.length
      else if (key.name === 'return') {
        const target = picker; const choice = target.choices[target.index]!
        if (target.name === 'queue') { picker = undefined; void submit(`/queue ${choice.value}`); redraw(); return }
        picker = undefined; busy = true; started = Date.now(); state.status = 'Running'
        void (async () => {
          try {
            note(await room.command(target.member, target.name, choice.value))
            if (target.name === 'model') { const choices = await room.choices(target.member, 'effort'); if (choices.length) picker = { name: 'effort', member: target.member, choices, index: Math.max(0, choices.findIndex(item => item.current)) } }
          } catch (error) { note(String(error)) }
          finally { busy = false; state.status = ready ? 'Ready' : 'Disconnected'; redraw() }
        })()
      }
      redraw(); return
    }
    if (key.name === 'escape') { if (busy) cancel(); else { state.editor = emptyEditor(); menuIndex = 0; redraw() }; return }
    if (key.ctrl && key.name === 'c') { if (busy) cancel(); else void stop(); return }
    if (key.ctrl && key.name === 't') { state.expandTools = !state.expandTools; redraw(); return }
    if (key.ctrl && key.name === 'end') { state.scroll = 0; redraw(); return }
    if (key.ctrl && key.name === 'd' && !state.editor.text) { void stop(); return }
    if (key.name === 'pageup' || key.name === 'pagedown') { state.scroll = Math.max(0, state.scroll + (key.name === 'pageup' ? 10 : -10)); redraw(); return }
    const matches = interaction ? [] : inputMenu()
    if (matches.length && (key.name === 'up' || key.name === 'down')) {
      menuIndex = (menuIndex + (key.name === 'down' ? 1 : -1) + matches.length) % matches.length; redraw(); return
    }
    if ((key.name === 'tab' || (key.name === 'return' && matches.length > 0)) && !interaction) {
      const first = inputMenu()[menuIndex]?.split('  ')[0]
      if (first) { if (key.name === 'return' || first.startsWith('@')) { state.editor = emptyEditor(); void submit(first) } else state.editor = { ...state.editor, text: first + ' ', cursor: graphemes(first).length + 1 } }
      menuIndex = 0; redraw(); return
    }
    menuIndex = 0
    const result = edit(state.editor, { name: key.name ?? '', ...(text ? { text } : {}), ctrl: !!key.ctrl, meta: !!key.meta, shift: !!key.shift })
    state.editor = result.state
    if (result.submit !== undefined) void submit(result.submit)
    redraw()
  }, text => { if (showingSetup) { if (setup.editing) setup.input += text.replace(/[\r\n]/g, ''); redraw(); return }; state.editor = edit(state.editor, { name: 'paste', text: text.replace(/\r\n?/g, '\n') }).state; redraw() }, delta => { if (!showingSetup) { state.scroll = Math.max(0, state.scroll + delta); redraw() } })
  const data = (chunk: string): void => input.feed(chunk)
  const resize = (): void => { previous = []; redraw() }
  const signal = (): void => { void stop() }
  const timer = setInterval(() => { tick++; if (busy || showingSetup || !ready) redraw() }, 100)
  process.stdin.setEncoding('utf8'); process.stdin.on('data', data)
  process.stdout.on('resize', resize); process.on('SIGTERM', signal); process.on('SIGHUP', signal)
  enterScreen()
  try {
    state.git = await workspaceStatus(state.cwd)
    if (configuration) {
      await refreshSetup()
      if (!configuration.force && configuration.settings.completed) {
        const member = configuration.settings.selected
        const members: MemberId[] = member === 'all' ? ['codex', 'claude'] : [member]
        if (members.every(value => setup.members[value]?.auth === 'signed-in')) await setupAction(member === 'all' ? 'all' : `use-${member}`)
      }
    } else await select('codex')
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
