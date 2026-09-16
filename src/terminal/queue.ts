import type { MemberId } from '../room/context.js'
export type Recipient = MemberId | 'all'
export interface QueuedMessage { text: string; recipient: Recipient }
export class MessageQueue {
  readonly items: QueuedMessage[] = []
  paused = false
  add(text: string, recipient: Recipient): void { if (this.items.length >= 20) throw new Error('队列已满，请先处理或撤回消息'); this.items.push({ text, recipient }) }
  take(): QueuedMessage | undefined { return this.paused ? undefined : this.items.shift() }
  withdraw(): QueuedMessage | undefined { return this.items.pop() }
  pause(): void { this.paused = true }
  resume(): void { this.paused = false }
  clear(): void { this.items.length = 0; this.paused = false }
}
export function parseRecipient(text: string, fallback: Recipient): QueuedMessage {
  const match = /^@(all|codex|claude)(?:\s+|$)/.exec(text)
  return match ? { recipient: match[1] as Recipient, text: text.slice(match[0].length).trimStart() } : { recipient: fallback, text }
}
