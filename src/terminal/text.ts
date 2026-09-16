import stringWidth from 'string-width'
import { stripVTControlCharacters } from 'node:util'
export const clean = (text: string): string => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\t/g, '    ')
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export const graphemes = (text: string): string[] => [...segmenter.segment(text)].map(part => part.segment)
export const width = (text: string): number => stringWidth(clean(text))
// 逐个字素累加宽度，不能每加一个字就重量整行：那是平方级，长历史下一帧要几百毫秒，转圈动画会把 CPU 占满。
// 输入已先 clean，按字素求 stringWidth 再求和，与整串测量结果一致（含 ZWJ 表情、组合符）。
// 字素宽度只取决于字素本身，缓存上限防止粘贴大段随机文本把表撑大。
const sizes = new Map<string, number>()
const graphemeWidth = (part: string): number => {
  let size = sizes.get(part)
  if (size === undefined) { size = stringWidth(part); if (sizes.size < 4096) sizes.set(part, size) }
  return size
}
export function fit(text: string, columns: number): string {
  let result = '', used = 0
  for (const part of graphemes(clean(text).replace(/\n/g, ' '))) {
    const size = graphemeWidth(part)
    if (used + size > columns) break
    result += part; used += size
  }
  return result + ' '.repeat(Math.max(0, columns - used))
}
export function wrap(text: string, columns: number): string[] {
  const lines: string[] = []
  let line = '', used = 0
  for (const part of graphemes(clean(text))) {
    if (part === '\n') { lines.push(line); line = ''; used = 0; continue }
    const size = graphemeWidth(part)
    if (used + size > columns && line) { lines.push(line); line = ''; used = 0 }
    if (size <= columns) { line += part; used += size }
  }
  lines.push(line)
  return lines
}
