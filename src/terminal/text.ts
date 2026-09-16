import stringWidth from 'string-width'
import { stripVTControlCharacters } from 'node:util'
export const clean = (text: string): string => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\t/g, '    ')
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export const graphemes = (text: string): string[] => [...segmenter.segment(text)].map(part => part.segment)
export const width = (text: string): number => stringWidth(clean(text))
export function fit(text: string, columns: number): string {
  let result = ''
  for (const part of graphemes(clean(text).replace(/\n/g, ' '))) {
    if (width(result + part) > columns) break
    result += part
  }
  return result + ' '.repeat(Math.max(0, columns - width(result)))
}
export function wrap(text: string, columns: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const part of graphemes(clean(text))) {
    if (part === '\n') { lines.push(line); line = ''; continue }
    if (width(line + part) > columns && line) { lines.push(line); line = '' }
    if (width(part) <= columns) line += part
  }
  lines.push(line)
  return lines
}
