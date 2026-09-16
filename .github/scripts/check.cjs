const { existsSync, readFileSync } = require('node:fs')
const { dirname, resolve } = require('node:path')
const { execFileSync } = require('node:child_process')

function checkMetadata(title, closingIssues) {
  if (!/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: [\x20-\x7e]+$/.test(title) || title.length > 80) {
    throw new Error('PR title must use an English conventional title, at most 80 characters.')
  }
  if (!(closingIssues > 0)) throw new Error('Link an Issue with Closes #123, Fixes #123, or the Development sidebar.')
}

// Check local file destinations only. Heading anchors and remote URLs are not validated.
function checkLinks(file, markdown) {
  const text = markdown.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '').replace(/`+[^`\n]*`+/g, '')
  const targets = [
    ...Array.from(text.matchAll(/\]\(<?([^\s>]+?)>?(?:\s+"[^"]*")?\)/g), m => m[1]),
    ...Array.from(text.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm), m => m[1]),
  ]
  return targets.filter(target => {
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) return false
    const path = decodeURIComponent(target.split(/[?#]/)[0])
    return path && !existsSync(resolve(dirname(file), path))
  })
}

if (require.main === module) {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(f => f.endsWith('.md'))
  const errors = files.flatMap(file => checkLinks(file, readFileSync(file, 'utf8')).map(target => `${file}: missing ${target}`))
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
  else console.log(`Relative file links checked in ${files.length} Markdown files.`)
}
module.exports = { checkMetadata, checkLinks }
