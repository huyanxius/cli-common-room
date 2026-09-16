#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const state = process.env.ROOM_TEST_AUTH_STATE
if (args.includes('--version')) console.log('fixture 1.0')
else if (args.includes('status')) {
  if (args.includes('--json')) console.log(JSON.stringify({ loggedIn: existsSync(state), authMethod: 'oauth_token', apiProvider: 'firstParty', email: 'private@example.test' }))
  else console.log(existsSync(state) ? 'Logged in using ChatGPT' : 'Not logged in')
  process.exitCode = existsSync(state) ? 0 : 1
} else if (args.includes('login')) {
  if (process.env.ROOM_TEST_AUTH_FAIL) { console.error('Authentication rejected'); process.exit(1) }
  console.log('Open https://example.test/authorize in your browser')
  process.stdin.once('data', data => {
    if (data.toString().trim() === 'valid-code') { writeFileSync(state, 'native-owned'); console.log('Login successful'); process.exit(0) }
    process.exit(1)
  })
  setInterval(() => {}, 1000)
} else process.exit(2)
