import { clean, graphemes } from './text.js'
export interface Editor { text: string; cursor: number; history: string[]; historyIndex: number; draft: string }
export interface Key { name: string; text?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }
export const emptyEditor = (): Editor => ({ text: '', cursor: 0, history: [], historyIndex: -1, draft: '' })
export function edit(previous: Editor, key: Key): { state: Editor; submit?: string } {
  const state = { ...previous }
  const chars = graphemes(state.text)
  if (key.name === 'return' && !key.meta && !key.shift) {
    if (!state.text.trim()) return { state }
    return { state: { ...emptyEditor(), history: [...state.history, state.text] }, submit: state.text }
  }
  if (key.name === 'left') state.cursor = Math.max(0, state.cursor - 1)
  else if (key.name === 'right') state.cursor = Math.min(chars.length, state.cursor + 1)
  else if (key.name === 'home' || (key.ctrl && key.name === 'a')) state.cursor = 0
  else if (key.name === 'end' || (key.ctrl && key.name === 'e')) state.cursor = chars.length
  else if (key.name === 'backspace') { if (state.cursor > 0) chars.splice(--state.cursor, 1); state.text = chars.join('') }
  else if (key.name === 'delete') { chars.splice(state.cursor, 1); state.text = chars.join('') }
  else if (key.ctrl && key.name === 'u') { chars.splice(0, state.cursor); state.cursor = 0; state.text = chars.join('') }
  else if (key.ctrl && key.name === 'k') { chars.splice(state.cursor); state.text = chars.join('') }
  else if (key.name === 'up' || key.name === 'down') {
    if (state.historyIndex < 0) state.draft = state.text
    state.historyIndex = key.name === 'up' ? Math.min(state.history.length - 1, state.historyIndex + 1) : Math.max(-1, state.historyIndex - 1)
    state.text = state.historyIndex < 0 ? state.draft : state.history[state.history.length - 1 - state.historyIndex] ?? ''
    state.cursor = graphemes(state.text).length
  } else if (key.name === 'paste' || (!key.ctrl && !key.meta && key.text) || (key.name === 'return' && (key.meta || key.shift))) {
    const insertion = graphemes(key.name === 'return' ? '\n' : clean(key.text ?? '').replace(/\r\n?/g, '\n'))
    if (state.text.length + insertion.join('').length > 100_000) return { state }
    chars.splice(state.cursor, 0, ...insertion); state.cursor += insertion.length; state.text = chars.join('')
  }
  return { state }
}
