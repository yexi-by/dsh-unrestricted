#!/usr/bin/env node
/**
 * Live acceptance check for dsh-unrestricted: boots the shipped Web
 * composition with the plugin installed exactly like `dsh plugin add file:`
 * does (a copy inside the profile's node_modules, bundle patch on top), then
 * assembles every preset with the toggle off and on.
 *
 * Asserts the acceptance contract:
 * - off: every mode's prompt and tool catalog are identical to no-plugin baselines
 * - on: standard/ptc/cordis/minimal and a delegated subagent all get the fused
 *   prompt; tools/contexts stay identical; plan mode flips the plan section only
 * - minimal works for sessions created before AND after the toggle
 * - toggling back off restores the original prompt everywhere
 *
 * Usage:
 *   node tools/verify-live.mjs --repo <path/to/deepseek-harness>
 *
 * Read-only against the repo. Requires the repo's `lib/` build outputs.
 */
import { mkdtemp, mkdir, cp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`missing --${name} <value>`)
  return process.argv[index + 1]
}

const repo = resolve(arg('repo'))
const pluginDir = resolve(fileURLToPath(new URL('..', import.meta.url)))

async function importPackage(relativeDir) {
  const manifest = JSON.parse(await readFile(join(repo, relativeDir, 'package.json'), 'utf8'))
  const entry = manifest.exports?.['.']?.default ?? manifest.main
  return import(pathToFileURL(join(repo, relativeDir, entry)).href)
}

import { readFile } from 'node:fs/promises'

const appBoot = await importPackage('packages/boot/app-boot')
const cmdline = await importPackage('packages/boot/cmdline')
const { SessionId } = await importPackage('packages/core/session')
const { renderPrompt } = await importPackage('packages/core/system-prompt')
const { applyChildComposition, childSessionMeta } = await importPackage('packages/subagent/subagent')
const rules = await import(pathToFileURL(join(pluginDir, 'src/rules.js')).href)

const home = await mkdtemp(join(tmpdir(), 'dsh-unrestricted-verify-'))
const settingsFile = join(home, 'settings.yaml')
await writeFile(settingsFile, '{}\n')

// Install the plugin the way `dsh plugin add file:` does: a real copy inside
// the profile tree, so its bare imports resolve through the healed fallback.
const profileDir = join(home, 'profiles', 'spec')
const pluginInstall = join(profileDir, 'node_modules', 'dsh-unrestricted')
await mkdir(dirname(pluginInstall), { recursive: true })
await cp(pluginDir, pluginInstall, {
  recursive: true,
  filter: (source) => !/node_modules|\.git|lib[\\/]client/.test(source),
})
await writeFile(join(profileDir, 'package.json'), JSON.stringify({ private: true }) + '\n')
const rootConfig = join(profileDir, 'cordis.yml')
await writeFile(rootConfig, '[]\n')

const overrides = [
  { id: 'settings', config: { path: settingsFile, watch: false } },
  { id: 'storage-json', config: { root: join(home, 'storages') } },
  { id: 'webserver', disabled: true },
  { id: 'web-runtime', disabled: true },
  { id: 'session-telemetry-otel', disabled: true },
  { id: 'skill-badge', disabled: false },
  { id: 'modules', disabled: true },
  { id: 'connection', disabled: true },
  { id: 'session-log-download', disabled: true },
  { id: 'client-hmr', disabled: true },
  { id: 'directory-picker', disabled: true },
  { insert: [
    { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
    { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
  ] },
  {
    id: 'agent-presets',
    config: {
      default: 'standard',
      roots: [],
      includeShippedRoot: true,
      includeUserRoot: false,
    },
  },
]

await appBoot.healProfilesModuleFallback({
  installAnchor: join(repo, 'apps/cli/package.json'),
  home,
})
const bundlePatches = [
  ...appBoot.loadOverlayPatches('dsh-test', join(repo, 'packages/bundle/base/cordis.patch.yml')),
  ...appBoot.loadOverlayPatches('dsh-test', join(repo, 'packages/bundle/web-app/cordis.patch.yml')),
  ...appBoot.loadOverlayPatches('dsh-unrestricted', join(pluginDir, 'cordis.patch.yml')),
]
const ctx = await appBoot.boot('dsh-test', rootConfig, [...bundlePatches, ...overrides], (bootCtx) => {
  cmdline.provideCmdline(bootCtx, { args: [], exit: () => {} })
})

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ok ${label}`)
  else {
    failures++
    console.error(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const AGENT_OPTIONS = { provider: 'deepseek', model: 'deepseek-chat' }
const AGENT_META = { cwd: 'C:\\fixture\\workspace' }
const agents = new Map()

async function presetAgent(id, suffix = '') {
  const key = `${id}${suffix}`
  if (!agents.has(key)) {
    agents.set(key, await ctx.agents.create({
      sessionId: SessionId(`verify-${key}`),
      meta: { ...AGENT_META, agentPreset: id },
      agentOptions: AGENT_OPTIONS,
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, id).then(() => undefined),
    }))
  }
  return agents.get(key).agent
}

async function assemblePrompt(agent) {
  const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
  return {
    text: renderPrompt(assembly),
    tools: JSON.stringify(assembly.tools),
    contexts: JSON.stringify(assembly.contexts),
    sections: assembly.sections.map(section => section.name),
  }
}

async function setEnabled(enabled) {
  await ctx.settings.update('unrestricted', { enabled })
}

/** Poll until the predicate holds or the deadline passes. */
async function until(label, fn, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

try {
  console.log('baseline (plugin installed, toggle off)')
  const baseline = {}
  for (const id of ['standard', 'ptc', 'cordis', 'minimal']) {
    baseline[id] = await assemblePrompt(await presetAgent(id))
  }
  check('standard baseline has no execution-mode block', !baseline.standard.text.includes(rules.EXECUTION_MODE_BLOCK))

  // An agent that exists BEFORE the toggle must switch on the next assembly.
  const preExisting = await presetAgent('standard', '-pre')
  check('minimal baseline is the stock persona', baseline.minimal.text === 'You are a helpful software engineer assistant.')

  console.log('toggle on')
  await setEnabled(true)

  await until('standard fusion', async () =>
    (await assemblePrompt(await presetAgent('standard'))).text.includes(rules.EXECUTION_MODE_BLOCK))

  for (const id of ['standard', 'ptc', 'cordis']) {
    const on = await assemblePrompt(await presetAgent(id))
    check(`${id} fused`, on.text.includes(rules.EXECUTION_MODE_BLOCK))
    check(`${id} keeps original content`, [...baseline[id].text.split('\n\n')].every(part => on.text.includes(part.replace('{{model}}', 'deepseek-chat').replace('{{cwd}}', AGENT_META.cwd))))
    check(`${id} tools unchanged`, on.tools === baseline[id].tools)
    check(`${id} contexts unchanged`, on.contexts === baseline[id].contexts)
  }

  const pre = await assemblePrompt(preExisting)
  check('pre-existing standard session fused on next assembly', pre.text.includes(rules.EXECUTION_MODE_BLOCK))
  check('pre-existing session tools unchanged', pre.tools === baseline.standard.tools)

  // Plan mode flips exactly one section.
  const planAgent = await presetAgent('standard', '-plan')
  planAgent.session.append('plan/mode', { active: true })
  const planOn = await assemblePrompt(planAgent)
  check('plan on: block present', planOn.text.includes(rules.EXECUTION_MODE_BLOCK))
  check('plan on: plan section kept', planOn.text.includes('You are in plan mode.'))
  check('plan on: plan boundary note appended', planOn.text.includes('Plan mode restricts delivery and mutation, not content'))
  planAgent.session.append('plan/mode', { active: false })
  const planOff = await assemblePrompt(planAgent)
  check('plan off: plan section gone', !planOff.text.includes('You are in plan mode.'))
  check('plan off: still fused', planOff.text.includes(rules.EXECUTION_MODE_BLOCK))

  // PTC mode keeps its run_code protocol.
  const ptc = await assemblePrompt(await presetAgent('ptc'))
  check('ptc keeps run_code rule', ptc.text.includes('`run_code` is the only tool you can call directly'))
  check('ptc transport note appended', ptc.text.includes('this rule governs only the tool-call transport'))
  check('ptc SDK section kept', ptc.text.includes('## Writing code for run_code'))

  // Cordis keeps its framework capability text.
  const cordis = await assemblePrompt(await presetAgent('cordis'))
  check('cordis keeps composition rules', cordis.text.includes('NEVER edit or delete the shipped preset install'))
  check('cordis keeps tool:cordis section', cordis.text.includes('# Dynamic Cordis Plugins'))

  // A delegated child fuses like its parent.
  const parent = await presetAgent('standard')
  const child = await parent.ctx.agents.create({
    sessionId: SessionId('verify-subagent'),
    meta: childSessionMeta(parent, 1, 0),
    agentOptions: AGENT_OPTIONS,
    setup: (agentCtx) => { applyChildComposition(agentCtx, parent, {}) },
  })
  try {
    const childPrompt = await assemblePrompt(child.agent)
    check('subagent fused', childPrompt.text.includes(rules.EXECUTION_MODE_BLOCK))
    check('subagent keeps persona anchor', childPrompt.text.includes('You are a coding agent powered by the'))
    check('subagent tools unchanged', childPrompt.tools === baseline.standard.tools)
  } finally {
    await child.dispose()
  }

  // Minimal: the complete-persona shadow path. Agents created before and after
  // the toggle must both converge on the fused minimal prompt.
  const minimalEarly = await presetAgent('minimal', '-early')
  const expectedMinimal = rules.fusedMinimalPrompt()
  const minimalAfter = await until('minimal shadow', async () => {
    const prompt = await assemblePrompt(await presetAgent('minimal'))
    return prompt.text === expectedMinimal ? prompt : false
  })
  check('minimal session created after toggle is fused', minimalAfter.text === expectedMinimal)
  const minimalEarlyPrompt = await until('minimal sweep', async () => {
    const prompt = await assemblePrompt(minimalEarly)
    return prompt.text === expectedMinimal ? prompt : false
  })
  check('minimal session created before toggle is fused (sweep)', minimalEarlyPrompt.text === expectedMinimal)
  check('minimal tools unchanged', minimalAfter.tools === baseline.minimal.tools)

  console.log('toggle off')
  await setEnabled(false)
  for (const id of ['standard', 'ptc', 'cordis', 'minimal']) {
    const off = await until(`${id} restore`, async () => {
      const prompt = await assemblePrompt(await presetAgent(id))
      return prompt.text === baseline[id].text ? prompt : false
    })
    check(`${id} restored to original`, off.text === baseline[id].text)
    check(`${id} tools still unchanged`, off.tools === baseline[id].tools)
  }
} finally {
  for (const handle of agents.values()) await handle.dispose()
  await ctx.fiber.dispose()
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('all live checks passed')
