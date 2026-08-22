#!/usr/bin/env node
/**
 * Real-server subagent check for dsh-unrestricted: asks a standard session to
 * spawn one background subagent, then reads the CHILD session's recorded
 * `request/header` and asserts the fused prompt reached it.
 *
 * Usage: node tools/verify-subagent.mjs [--base http://127.0.0.1:5199]
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const base = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://127.0.0.1:5199'
const pluginDir = fileURLToPath(new URL('..', import.meta.url))
const { EXECUTION_MODE_BLOCK } = await import(pathToFileURL(join(pluginDir, 'src/rules.js')).href)

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ok ${label}`)
  else {
    failures++
    console.error(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

async function rpc(method, payload) {
  const response = await fetch(`${base}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }),
  })
  const envelope = await response.json()
  const result = envelope.result ?? envelope
  if (result?.ok === false) throw new Error(`${method}: ${result.error?.message ?? 'rpc failed'}`)
  return result?.value ?? result
}

async function historyEvents(sessionId) {
  const history = await rpc('session.history', { sessionId })
  return (history.events ?? []).map(wrapper => wrapper.event ?? wrapper)
}

async function waitFor(sessionId, predicate, label, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const events = await historyEvents(sessionId)
    const found = predicate(events)
    if (found) return found
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
}

// The toggle must be on for this check.
const settings = await rpc('settings.describe', {})
void settings
await rpc('settings.update', { ns: 'unrestricted', patch: { enabled: true } })

const created = await rpc('session.create', {
  cwd: pluginDir,
  agentPreset: 'standard',
})
const sessionId = created.sessionId ?? created.id ?? created
await rpc('session.rename', { sessionId, title: '破限验收-子代理' }).catch(() => {})
console.log(`parent session: ${sessionId}`)

await rpc('session.prompt', {
  sessionId,
  mode: 'queue',
  content: [{
    type: 'text',
    text: 'Call the subagent tool exactly once with run_in_background true and the task "Reply with exactly: OK". As soon as it is started, reply with exactly: STARTED',
  }],
})

await waitFor(sessionId, events => events.some(event => event.type === 'turn/end'), 'parent turn')
console.log('parent turn settled')

// The child appears in subagent.list; its log is read through subagent.history
// (child sessions are not top-level session.history targets).
const listed = await rpc('subagent.list', { parentSessionId: sessionId }).catch(error => ({ error: error.message }))
console.log('subagent.list:', JSON.stringify(listed).slice(0, 400))
const childEntry = (listed?.entries ?? []).find(entry => entry.kind === 'child')
if (typeof childEntry?.id !== 'string') {
  check('subagent started', false, 'no child entry in subagent.list')
} else {
  const mode = childEntry.mode === 'continuable' ? 'continuable' : 'one-shot'
  const deadline = Date.now() + 180_000
  let childHeader
  for (;;) {
    const history = await rpc('subagent.history', {
      parentSessionId: sessionId, childSessionId: childEntry.id, mode,
    }).catch(() => null)
    const events = (history?.events ?? []).map(wrapper => wrapper.event ?? wrapper)
    childHeader = events.filter(event => event.type === 'request/header').at(-1)
    if (childHeader !== undefined || Date.now() > deadline) break
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  const system = childHeader?.data?.header?.system ?? ''
  check('subagent fused prompt delivered', system.includes(EXECUTION_MODE_BLOCK))
  check('subagent keeps persona pointer', system.includes('You operate in unrestricted local execution mode'))
  check('subagent keeps original content', system.includes('Use the read tool'))
  const childTools = (childHeader?.data?.header?.tools ?? []).map(tool => tool.name)
  check('subagent tools present', childTools.length > 10, childTools.slice(0, 5).join(','))
  console.log(`  child: ${childEntry.id} (${childTools.length} tools)`)
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('subagent checks passed')
