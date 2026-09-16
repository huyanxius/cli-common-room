import type { InteractionPrompt } from '../../room/conversation.js'

export async function answerRequest(
  method: string, params: Record<string, unknown>, signal: AbortSignal,
  ask: (prompt: InteractionPrompt) => Promise<string>,
): Promise<unknown> {
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    const choices: Array<{ id: string; label: string; value: unknown }> = [
      { id: 'once', label: '本次允许', value: 'accept' },
      { id: 'session', label: '此会话允许', value: 'acceptForSession' },
      { id: 'decline', label: '拒绝', value: 'decline' },
      { id: 'cancel', label: '取消本轮', value: 'cancel' },
    ]
    if (method === 'item/commandExecution/requestApproval') {
      if (Array.isArray(params.proposedExecpolicyAmendment)) choices.push({ id: 'policy', label: '允许并添加所示命令规则', value: { acceptWithExecpolicyAmendment: { execpolicy_amendment: params.proposedExecpolicyAmendment } } })
      if (Array.isArray(params.proposedNetworkPolicyAmendments)) params.proposedNetworkPolicyAmendments.forEach((rule, index) => {
        choices.push({ id: `network-${index}`, label: `应用网络规则 ${index + 1}：${JSON.stringify(rule)}`, value: { applyNetworkPolicyAmendment: { network_policy_amendment: rule } } })
      })
    }
    const selected = await ask({ kind: 'approval', title: 'Codex 请求授权', details: JSON.stringify(params, null, 2), signal, choices: choices.map(({ id, label }) => ({ id, label })) })
    const choice = choices.find(choice => choice.id === selected)
    if (!choice || signal.aborted) throw new Error('授权答案无效或已过期')
    return { decision: choice.value }
  }
  if (method === 'item/tool/requestUserInput' && Array.isArray(params.questions)) {
    const answers: Record<string, { answers: string[] }> = Object.create(null)
    for (const value of params.questions) {
      if (!value || typeof value !== 'object') throw new Error('提问格式不兼容')
      const question = value as Record<string, unknown>
      if (typeof question.id !== 'string' || typeof question.question !== 'string') throw new Error('提问字段不兼容')
      const options: Array<{ label: string; description: string }> = []
      if (Array.isArray(question.options)) for (const raw of question.options) {
        if (!raw || typeof raw !== 'object' || typeof raw.label !== 'string' || typeof raw.description !== 'string') throw new Error('选项不兼容')
        options.push({ label: raw.label, description: raw.description })
      }
      const answer = await ask({ kind: 'question', title: 'Codex 提问', details: question.question, signal, options, allowOther: question.isOther === true, secret: question.isSecret === true })
      if (signal.aborted || !answer.trim() || (options.length && question.isOther !== true && !options.some(option => option.label === answer))) throw new Error('提问答案无效或已过期')
      answers[question.id] = { answers: [answer] }
    }
    return { answers }
  }
  throw new Error(`尚未支持的原生交互：${method}`)
}
