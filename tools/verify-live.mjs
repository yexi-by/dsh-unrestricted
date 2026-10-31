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
 * - enabling in the initial profile waits for preset registration before fusion
 *
 * Usage:
 *   node tools/verify-live.mjs --repo <path/to/deepseek-harness> [--boot-enabled]
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
const bootEnabled = process.argv.includes('--boot-enabled')

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

// Install the plugin the way `dsh plugin add file:` does: a real copy inside
// the profile tree, then register the official runtime package resolution.
const profileDir = join(home, 'profiles', 'spec')
const pluginInstall = join(profileDir, 'node_modules', 'dsh-unrestricted')
await mkdir(dirname(pluginInstall), { recursive: true })
await cp(pluginDir, pluginInstall, {
  recursive: true,
  filter: (source) => !/node_modules|\.git|lib[\\/]client/.test(source),
})
appBoot.initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-unrestricted'])
const rootConfig = join(profileDir, 'cordis.yml')
await writeFile(rootConfig, '[]\n')

const overrides = [
  { id: 'storage-json', config: { root: join(home, 'storages') } },
  { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
  { id: 'webserver', inject: [], config: { host: '127.0.0.1', port: 0 } },
  { id: 'web-runtime', disabled: true },
  { id: 'session-telemetry-otel', disabled: true },
  { id: 'modules', disabled: true },
  { id: 'connection', inject: ['webServer'], config: { trustedHosts: [] } },
  { id: 'open-in-app', disabled: true },
  { id: 'session-log-download', disabled: true },
  { id: 'client-hmr', disabled: true },
  { id: 'hmr', disabled: true },
  { id: 'directory-picker', disabled: true },
  { insert: [
    { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
    { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
  ] },
  {
    id: 'agent-preset-registry',
    config: {
      default: 'standard',
    },
  },
]
if (bootEnabled) overrides.push({ id: 'unrestricted', config: { enabled: true } })

const installAnchor = join(repo, 'apps/cli/package.json')
const profile = {
  name: 'spec', dir: profileDir, layers: [],
  patchPath: join(profileDir, 'cordis.patch.yml'), patches: [],
  skippedBundles: [],
}
const resolution = await appBoot.createRuntimeResolution({ installAnchor, home, profile })
const webDir = join(repo, 'packages/bundle/web-app')
const webManifest = JSON.parse(await readFile(join(webDir, 'package.json'), 'utf8'))
const webPatches = appBoot.bundlePatchPaths(webDir, webManifest.dsh.bundle)
  .flatMap(path => appBoot.loadOverlayPatches('dsh-test', path))
const bundlePatches = [
  ...appBoot.loadOverlayPatches('dsh-test', join(repo, 'packages/bundle/base/cordis.patch.yml')),
  ...webPatches,
  ...appBoot.loadOverlayPatches('dsh-unrestricted', join(pluginDir, 'cordis.patch.yml')),
]
const ctx = await appBoot.boot('dsh-test', rootConfig, [...bundlePatches, ...overrides], async (bootCtx) => {
  bootCtx.provide('profileContext', {
    name: 'spec', dir: profileDir, patchPath: profile.patchPath,
    installAnchor, home, cwd: home,
    startedBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-unrestricted'],
    overlays: overrides, telemetryDisabledEnv: '1',
  })
  await bootCtx.plugin(appBoot.PluginPackages, { resolution })
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
const AGENT_META = { cwd: home }
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

/** 用原生子代理组合和作用域工具注册复现 Minimal 的角色及报告协议。 */
async function minimalChild(suffix, persona) {
  const parent = await presetAgent('minimal')
  const handle = await parent.ctx.agents.create({
    sessionId: SessionId(`verify-minimal-child-${suffix}`),
    meta: childSessionMeta(parent, 1, false),
    agentOptions: AGENT_OPTIONS,
    setup: agentCtx => {
      applyChildComposition(agentCtx, parent, persona === undefined ? {} : { persona })
      if (persona !== undefined) {
        agentCtx.systemPrompt.section({ name: 'review:criteria', order: 20, text: 'Preserve the supplied review criteria.' })
      }
      agentCtx.tools.register({
        name: 'structured_output', description: 'Report a structured review.',
        parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        output: { schema: { type: 'object', properties: {}, additionalProperties: false }, render: () => [] },
        execute: async () => { throw new Error('This assembly check must not execute a tool') },
      })
      agentCtx.systemPrompt.section({
        name: 'tool:structured_output',
        order: agentCtx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
        text: rules.ANCHORS.structuredOutputFull,
      })
    },
  })
  agents.set(`minimal-child-${suffix}`, handle)
  return handle.agent
}

/**
 * Reproduce the card's preview path without the browser: assemble the standing
 * scope, fuse it, and render it through the same harness renderer the host
 * half's `preview` endpoint uses.
 * @param presetId - preset id to preview.
 * @returns the rendered preview text.
 */
async function preview(presetId) {
  const { createScope } = await importPackage('packages/core/scope')
  const key = {}
  const scope = createScope(ctx, key)
  let assembly
  try {
    await ctx.agentPresets.mount(scope.ctx, presetId)
    assembly = await ctx.systemPrompt.assemble({ scope: key })
  } finally {
    await scope.dispose()
  }
  const fused = presetId === 'minimal'
    ? { sections: [{ name: 'deployment:persona-prefix', text: rules.fusedMinimalPrompt() }] }
    : rules.fuseSections(assembly.sections, presetId)
  if (fused.issues !== undefined) throw new Error(`preview issues: ${fused.issues.join('; ')}`)
  return rules.renderPreview({ ...assembly, sections: fused.sections }, renderPrompt)
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

if (bootEnabled) {
  try {
    for (const id of ['standard', 'ptc', 'cordis', 'minimal']) {
      try {
        await until(`${id} fusion on startup`, async () => {
          const prompt = await assemblePrompt(await presetAgent(id))
          return prompt.text.includes(rules.EXECUTION_MODE_BLOCK)
        }, 3_000)
        check(`${id} fused when enabled at startup`, true)
      } catch (error) {
        check(`${id} fused when enabled at startup`, false, error.message)
      }
    }
  } finally {
    for (const handle of agents.values()) await handle.dispose()
    await ctx.fiber.dispose()
  }
  if (failures > 0) process.exit(1)
  console.log('startup-enabled checks passed')
  process.exit(0)
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
  const customPersona = 'Review only this delegated code and preserve the caller role.'
  const customMinimal = await minimalChild('custom-before-toggle', customPersona)
  const customBaseline = await assemblePrompt(customMinimal)
  const structuredMinimal = await minimalChild('structured-before-toggle')
  const structuredBaseline = await assemblePrompt(structuredMinimal)

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
    check(`${id} keeps the instrument-only scope`, on.text.includes('this contract decides the content'))
    check(`${id} keeps targets verbatim`, on.text.includes('render it exactly as named, verbatim'))
    check(`${id} adds no classifier-trigger vocabulary`, !on.text.includes('Do not use refusal phrasing'))
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
  check('plan on: plan keeps the contract scope', planOn.text.includes('this contract decides the content'))
  planAgent.session.append('plan/mode', { active: false })
  const planOff = await assemblePrompt(planAgent)
  check('plan off: plan section gone', !planOff.text.includes('You are in plan mode.'))
  check('plan off: still fused', planOff.text.includes(rules.EXECUTION_MODE_BLOCK))

  // PTC mode keeps its run_code protocol.
  const ptc = await assemblePrompt(await presetAgent('ptc'))
  check('ptc keeps run_code rule', ptc.text.includes('`run_code` is the only tool you can call directly'))
  check('ptc transport note appended', ptc.text.includes('this rule governs only the tool-call transport'))
  check('ptc notes the opening phrases are prose-only', ptc.text.includes('not inside the program'))
  check('ptc SDK section kept', ptc.text.includes('## Writing code for run_code'))

  // A delegated child fuses like its parent.
  const parent = await presetAgent('standard')
  const child = await parent.ctx.agents.create({
    sessionId: SessionId('verify-subagent'),
    meta: childSessionMeta(parent, 1, false),
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

  // 既有子代理由开启时的 sweep 处理；新子代理由 created 事件处理。
  const customAfterEnable = await minimalChild('custom-after-toggle', customPersona)
  for (const [label, agent] of [['existing', customMinimal], ['new', customAfterEnable]]) {
    const prompt = await assemblePrompt(agent)
    check(`minimal ${label} custom child keeps its persona and system rule`,
      prompt.text.includes(customPersona) && prompt.text.includes('Preserve the supplied review criteria.'))
    check(`minimal ${label} custom child fuses once and keeps the report protocol`,
      prompt.text.split(rules.EXECUTION_MODE_BLOCK).length === 2
      && prompt.text.includes(rules.ANCHORS.structuredOutputFull))
    check(`minimal ${label} custom child keeps tools and contexts`,
      prompt.tools === customBaseline.tools && prompt.contexts === customBaseline.contexts)
  }
  const structuredPrompt = await assemblePrompt(structuredMinimal)
  check('minimal scoped structured tool keeps its native system instruction',
    JSON.parse(structuredPrompt.tools).some(tool => tool.name === 'structured_output')
    && structuredPrompt.text.includes(rules.ANCHORS.structuredOutputFull))
  check('minimal structured child keeps its original tools and contexts',
    structuredPrompt.tools === structuredBaseline.tools && structuredPrompt.contexts === structuredBaseline.contexts)

  // Blank-session preset switching (`agentPresets.select`):
  // 1) minimal -> standard must drop the complete persona shadow so the full
  //    standard prompt and tools are assembled.
  // 2) standard -> minimal must install the complete persona shadow immediately
  //    so the first assembly after selection is already fused.
  const switchedAgent = await presetAgent('minimal', '-switch')
  await until('minimal initial shadow', async () =>
    (await assemblePrompt(switchedAgent)).text === expectedMinimal)
  await ctx.agentPresets.select(switchedAgent, 'standard')
  const switchedToStandard = await assemblePrompt(switchedAgent)
  check('minimal -> standard switch drops complete shadow and fuses standard',
    switchedToStandard.text.includes(rules.EXECUTION_MODE_BLOCK)
    && switchedToStandard.text.includes('You are a coding agent powered by the')
    && switchedToStandard.text.length > expectedMinimal.length)
  await ctx.agentPresets.select(switchedAgent, 'minimal')
  const switchedToMinimal = await until('standard -> minimal switch shadow', async () => {
    const prompt = await assemblePrompt(switchedAgent)
    return prompt.text === expectedMinimal ? prompt : false
  })
  check('standard -> minimal switch installs complete shadow on first assembly',
    switchedToMinimal.text === expectedMinimal)

  // Deploy preview: the card reads the contract from the same standing scope
  // the probes use. A standing scope has no agent, so it binds no {{model}}
  // and carries none of the agent-only sections (context:file-reference,
  // tool:subagent) — the preview is the contract's placement, not a byte copy of
  // a live request. Both facts are pinned here.
  console.log('deploy preview')
  const liveStandard = (await assemblePrompt(await presetAgent('standard'))).text
  const standardPreview = await preview('standard')
  check('preview carries the contract verbatim', standardPreview.includes(rules.EXECUTION_MODE_BLOCK))
  check('preview keeps the original identity opening', standardPreview.startsWith(rules.ANCHORS.identity))
  const previewPersona = standardPreview.indexOf('You are a coding agent powered by the')
  const previewBlock = standardPreview.indexOf(rules.EXECUTION_MODE_BLOCK)
  check('preview places the contract behind the persona', previewPersona >= 0 && previewBlock > previewPersona)
  check('preview leaves the unbound model slot literal', standardPreview.includes('{{model}}'))
  check('the live prompt itself has no literal slots left', !/\{\{\w+\}\}/.test(liveStandard))
  // Filling the slots must land on the live prefix: identity, persona, contract.
  const filledPreview = standardPreview.replaceAll('{{model}}', 'deepseek-chat').replaceAll('{{cwd}}', AGENT_META.cwd)
  check('filled preview matches the live prompt up to the contract', filledPreview.startsWith(liveStandard.slice(0, liveStandard.indexOf('Tokens prefixed with @'))))
  check('preview is larger than the contract alone', standardPreview.length > rules.EXECUTION_MODE_BLOCK.length)
  for (const id of ['ptc', 'cordis', 'minimal']) {
    const text = await preview(id)
    check(`${id} preview carries the contract`, text.includes(rules.EXECUTION_MODE_BLOCK))
  }

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
  for (const [label, agent, expected] of [
    ['existing custom', customMinimal, customBaseline],
    ['new custom', customAfterEnable, customBaseline],
    ['structured', structuredMinimal, structuredBaseline],
  ]) {
    const off = await assemblePrompt(agent)
    check(`minimal ${label} child restores native bytes after disabling`,
      off.text === expected.text && off.tools === expected.tools && off.contexts === expected.contexts)
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
