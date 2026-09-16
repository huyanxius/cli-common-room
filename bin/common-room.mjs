#!/usr/bin/env node
import { existsSync } from 'node:fs'
const entry = new URL('../dist/src/main.js', import.meta.url)
if (!existsSync(entry)) {
  console.error('Common Room 尚未构建，请在安装目录运行 npm ci && npm run build。')
  process.exitCode = 1
} else await import(entry.href)
