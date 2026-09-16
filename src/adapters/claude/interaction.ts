import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { SessionOptions } from '../../room/conversation.js'
export async function answerToolPermission(tool: string, input: Record<string, unknown>, options: { signal: AbortSignal }, interact: NonNullable<SessionOptions['interact']>): Promise<PermissionResult> {
  if (options.signal.aborted) throw new Error('交互已过期')
  if (tool === 'AskUserQuestion') {
    if (!Array.isArray(input.questions)) throw new Error('问题格式不兼容')
    const answers: Record<string, string> = {}
    for (const raw of input.questions) {
      const question = raw as { question: string; options: { label: string; description: string }[]; multiSelect?: boolean }
      if (typeof question.question !== 'string' || !Array.isArray(question.options)) throw new Error('问题格式不兼容')
      answers[question.question] = await interact({ kind: 'question', title: 'Claude Code 提问', details: question.question + (question.multiSelect ? '\n可填写多个选项，以逗号分隔' : ''), options: question.options, allowOther: true, secret: false, signal: options.signal })
      if (options.signal.aborted) throw new Error('交互已过期')
    }
    return { behavior: 'allow', updatedInput: { ...input, answers } }
  }
  const choice = await interact({ kind: 'approval', title: `Claude Code · ${tool}`, details: JSON.stringify(input, null, 2), signal: options.signal, choices: [{ id: 'allow', label: '仅允许本次' }, { id: 'deny', label: '拒绝' }, { id: 'cancel', label: '停止本轮' }] })
  if (options.signal.aborted) throw new Error('交互已过期')
  if (choice === 'allow') return { behavior: 'allow', updatedInput: input }
  if (choice === 'deny' || choice === 'cancel') return { behavior: 'deny', message: '用户拒绝此操作', interrupt: choice === 'cancel' }
  throw new Error('无效授权选项')
}
