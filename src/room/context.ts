export type MemberId = 'claude' | 'codex'

// 群历史仅保存用户发言和成员完整回复；工具日志与未完成增量不能进入交付上下文。
export interface HistoryMessage {
  readonly roomId: string
  readonly sequence: number
  readonly author: 'user' | MemberId
  readonly text: string
}

// deliveredThrough 表示原生会话已确认接收的群历史位置，不是已展示位置或轮次完成位置。
export interface MemberSession {
  readonly roomId: string
  readonly member: MemberId
  readonly nativeSessionId: string | null
  readonly deliveredThrough: number
}

export interface Delivery {
  readonly member: MemberId
  readonly roomId: string
  readonly nativeSessionId: string | null
  readonly throughSequence: number
  readonly messages: readonly HistoryMessage[]
}

const members: readonly string[] = ['claude', 'codex']

export function planDeliveries(
  roomId: string,
  history: readonly HistoryMessage[],
  sessions: readonly MemberSession[],
  recipients: readonly MemberId[],
): readonly Delivery[] {
  if (!roomId.trim()) throw new Error('群 ID 不能为空')
  if (!recipients.length || new Set(recipients).size !== recipients.length || recipients.some(id => !members.includes(id))) {
    throw new Error('请选择有效且不重复的接收者')
  }
  history.forEach((message, index) => {
    if (message.roomId !== roomId) throw new Error('历史属于另一个群')
    if (message.sequence !== index + 1) throw new Error('历史顺序必须从 1 连续递增')
    if (!['user', ...members].includes(message.author)) throw new Error('未知发言者')
  })
  const throughSequence = history.length
  const byMember = new Map<MemberId, MemberSession>()
  for (const session of sessions) {
    if (session.roomId !== roomId) throw new Error('原生会话属于另一个群')
    if (!members.includes(session.member)) throw new Error('未知会话成员')
    if (byMember.has(session.member)) throw new Error('成员会话重复')
    if (!Number.isSafeInteger(session.deliveredThrough) || session.deliveredThrough < 0 || session.deliveredThrough > throughSequence) {
      throw new Error('交付游标不在当前群历史范围内')
    }
    if (session.nativeSessionId === null) {
      if (session.deliveredThrough !== 0 || history.some(message => message.author === session.member)) {
        throw new Error('新会话不能冒充已有会话恢复')
      }
    } else if (!session.nativeSessionId.trim()) {
      throw new Error('原生会话 ID 不能为空')
    }
    byMember.set(session.member, session)
  }
  return Object.freeze(recipients.map(member => {
    const session = byMember.get(member)
    if (!session) throw new Error(`成员 ${member} 缺少会话绑定`)
    const messages = history
      .filter(message => message.sequence > session.deliveredThrough && message.author !== member)
      .map(({ roomId, sequence, author, text }) => Object.freeze({ roomId, sequence, author, text }))
    return Object.freeze({ member, roomId, nativeSessionId: session.nativeSessionId, throughSequence, messages: Object.freeze(messages) })
  }))
}
