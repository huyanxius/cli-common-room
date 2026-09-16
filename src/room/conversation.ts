import type { Telemetry } from './telemetry.js'
export interface NativeCommand { name: string; description: string }
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
  resumeThreadId?: string
  onCommands?: (commands: NativeCommand[]) => void
  onDisconnect?: (error: Error) => void
  onTelemetry?: (value: Telemetry) => void
  turnTimeoutMs?: number
  onEvent?: (event: SessionEvent) => void
  interact?: (prompt: InteractionPrompt) => Promise<string>
}
export interface TurnResult { status: 'completed' | 'cancelled' | 'failed'; text: string }
export interface Conversation {
  initialize(): Promise<{ threadId: string; model: string }>
  run(text: string): Promise<TurnResult>
  command?(name: string, argument: string): Promise<string>
  cancel(): Promise<void>
  close(): Promise<void>
}
