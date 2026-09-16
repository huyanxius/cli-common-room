import { createInterface } from 'node:readline/promises'
import { stripVTControlCharacters } from 'node:util'
import type { Conversation, InteractionPrompt, SessionOptions } from '../room/conversation.js'

// 流式分段也必须去掉单独的 ESC；不能让模型或工具输出控制终端。
export const safeText = (text: string): string => stripVTControlCharacters(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')

export async function nativeChat(create: (options: SessionOptions) => Conversation): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('聊天需要交互终端，请在 Terminal.app 中运行')
  const input = createInterface({ input: process.stdin, output: process.stdout })
  const lifetime = new AbortController()
  let running = false
  let stopping = false
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  const question = (text: string, signal = lifetime.signal) => input.question(text, { signal: AbortSignal.any([signal, lifetime.signal]) })
  const interact = async (prompt: InteractionPrompt): Promise<string> => {
    if (prompt.kind === 'question' && prompt.secret) throw new Error('此入口尚不支持隐藏输入，请使用原生 CLI 处理敏感提问')
    // 清除流式输出期间误键入的半行，避免把它当作授权答案。
    input.write('', { ctrl: true, name: 'u' })
    console.log(`\n${safeText(prompt.title)}\n${safeText(prompt.details)}`)
    if (prompt.kind === 'approval') {
      prompt.choices.forEach((choice, index) => console.log(`${index + 1}. ${safeText(choice.label)}`))
      while (true) {
        const answer = await question('选择编号（无默认授权）：', prompt.signal)
        const choice = /^\d+$/.test(answer.trim()) ? prompt.choices[Number(answer.trim()) - 1] : undefined
        if (choice) return choice.id
      }
    }
    prompt.options.forEach((option, index) => console.log(`${index + 1}. ${safeText(option.label)} — ${safeText(option.description)}`))
    while (true) {
      const answer = await question(prompt.options.length ? '选择编号或输入答案：' : '回答：', prompt.signal)
      const selected = /^\d+$/.test(answer.trim()) ? prompt.options[Number(answer.trim()) - 1] : undefined
      if (selected) return selected.label
      if (answer.trim() && (!prompt.options.length || prompt.allowOther)) return answer
    }
  }
  const session = create({ cwd: process.cwd(), interact, onEvent: event => {
    if (event.type === 'text') process.stdout.write(safeText(event.text))
    else console.log(`\n[Codex 工具] ${safeText(event.text)}`)
  } })
  input.on('close', () => { lifetime.abort(); void session.close() })
  input.on('SIGINT', () => {
    if (!running || stopping) { lifetime.abort(); void session.close(); input.close(); return }
    stopping = true
    console.log('\n正在请求停止 Codex…')
    stopTimer = setTimeout(() => { console.error('未收到停止确认，关闭连接，执行结果未知。'); void session.close() }, 5000)
    void session.cancel().catch(() => { void session.close() })
  })
  try {
    const info = await session.initialize()
    console.log(`Codex · ${safeText(info.model)}\n工作目录：${safeText(process.cwd())}\n/exit 退出；回答中 Ctrl+C 停止。当前为单成员接入，尚非完整群聊。`)
    while (!lifetime.signal.aborted) {
      const text = await question('\n你 > ')
      if (text.trim() === '/exit') break
      if (!text.trim()) continue
      running = true
      process.stdout.write('\nCodex > ')
      try {
        const result = await session.run(text)
        console.log(result.status === 'completed' ? '\n' : `\n[${result.status === 'cancelled' ? '已停止' : '本轮失败'}]`)
      } finally { running = false; stopping = false; clearTimeout(stopTimer) }
    }
  } catch (error) { if (!lifetime.signal.aborted) throw error }
  finally { clearTimeout(stopTimer); input.close(); await session.close() }
}
