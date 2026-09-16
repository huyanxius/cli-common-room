export interface SessionEvent { type: 'text' | 'tool' | 'notice'; text: string }
export type InteractionPrompt = {
  readonly title: string
  readonly details: string
  readonly signal: AbortSignal
} & (
  | { readonly kind: 'approval'; readonly choices: readonly { id: string; label: string }[] }
  | { readonly kind: 'question'; readonly options: readonly { label: string; description: string }[]; readonly allowOther: boolean; readonly secret: boolean }
)
export interface SessionOptions {
  cwd: string
  turnTimeoutMs?: number
  onEvent?: (event: SessionEvent) => void
  interact?: (prompt: InteractionPrompt) => Promise<string>
}
export interface TurnResult { status: 'completed' | 'cancelled' | 'failed'; text: string }
export interface Conversation {
  initialize(): Promise<{ threadId: string; model: string }>
  run(text: string): Promise<TurnResult>
  cancel(): Promise<void>
  close(): Promise<void>
}
