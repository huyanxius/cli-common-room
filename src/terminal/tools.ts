import type { ToolActivity } from '../room/conversation.js'
import { clean } from './text.js'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function toolSummary(tool: ToolActivity): { title: string; detail: string } {
  const input = record(tool.input)
  const action = input.description ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.command ?? ''
  const title = `${tool.name}${typeof action === 'string' && action ? `  ${clean(action).split('\n')[0]}` : ''}`
  const detail = [typeof input.command === 'string' ? `$ ${input.command}` : '', tool.output ?? ''].filter(Boolean).join('\n')
  return { title, detail: clean(detail) }
}
