import { memberIds, type MemberId } from '../room/context.js'
export type Recipient = MemberId | 'all' | readonly MemberId[]
export function recipients(value: Recipient, available: readonly MemberId[] = memberIds): MemberId[] { return [...new Set(value === 'all' ? available : typeof value === 'string' ? [value] : value)] }
export function mentions(value: Recipient): string { return typeof value === 'string' ? `@${value}` : value.map(member => `@${member}`).join(' ') }
export interface QueuedMessage { text: string; recipient: Recipient }
export class MessageQueue {
  readonly items: QueuedMessage[] = []
  paused = false
  add(text: string, recipient: Recipient): void { if (this.items.length >= 20) throw new Error('队列已满，请先处理或撤回消息'); this.items.push({ text, recipient: typeof recipient === 'string' ? recipient : Object.freeze([...recipient]) }) }
  take(): QueuedMessage | undefined { return this.paused ? undefined : this.items.shift() }
  withdraw(): QueuedMessage | undefined { return this.items.pop() }
  pause(): void { this.paused = true }
  resume(): void { this.paused = false }
  clear(): void { this.items.length = 0; this.paused = false }
}
export function parseRecipient(text: string, fallback: Recipient): QueuedMessage {
  const selected: MemberId[] = []
  let allOnly = false, count = 0
  const body = text.replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`|(^|[\s，。！？、:：])@(all|codex|claude|agy)(?=$|[\s，。！？、:：])/g, (token, boundary: string | undefined, member: MemberId | 'all' | undefined) => {
    if (!member) return token
    count++; allOnly = count === 1 && member === 'all'
    for (const id of recipients(member)) if (!selected.includes(id)) selected.push(id)
    return boundary ?? ''
  })
  return selected.length ? { recipient: allOnly ? 'all' : selected.length === 1 ? selected[0]! : Object.freeze(selected), text: body.trim() } : { recipient: fallback, text }
}
