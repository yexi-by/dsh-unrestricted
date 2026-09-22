#!/usr/bin/env node
/**
 * Dump the original per-preset system prompts from a local DeepSeek Harness
 * checkout. Read-only against the repo: boots the shipped Web composition
 * (same overrides as apps/cli/tests/web-agent-presets.e2e.ts, minus anything
 * that binds a port or touches the network), mounts each preset, assembles
 * with a real agent context, and renders the exact prompt a model receives.
 *
 * Usage:
 *   node tools/dump-prompts.mjs --repo <path/to/deepseek-harness> --out <dir>
 *
 * Nothing is written into the repo. Requires the repo's `lib/` build outputs.
 */
import { execSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`missing --${name} <value>`)
  }
  return process.argv[index + 1]
}

const repo = resolve(arg('repo'))
const out = resolve(arg('out'))
const FIXTURE_CWD = '/workspace/dsh-unrestricted'

async function importPackage(relativeDir) {
  const manifestPath = join(repo, relativeDir, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const entry = manifest.exports?.['.']?.default ?? manifest.main
  if (typeof entry !== 'string') throw new Error(`no entry for ${relativeDir}`)
  return import(pathToFileURL(join(repo, relativeDir, entry)).href)
}

const appBoot = await importPackage('packages/boot/app-boot')
const cmdline = await importPackage('packages/boot/cmdline')
const { SessionId } = await importPackage('packages/core/session')
const { renderPrompt } = await importPackage('packages/core/system-prompt')
const { applyChildComposition, childSessionMeta } = await importPackage('packages/subagent/subagent')

const BASE_PATCH = join(repo, 'packages/bundle/base/cordis.patch.yml')
const INSTALL_ANCHOR = join(repo, 'apps/cli/package.json')

const home = await mkdtemp(join(tmpdir(), 'dsh-prompt-dump-'))

const overrides = [
  { id: 'storage-json', config: { root: join(home, 'storages') } },
  { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
  { id: 'webserver', inject: [], config: { host: '127.0.0.1', port: 0 } },
  { id: 'web-runtime', disabled: true },
  { id: 'session-telemetry-otel', disabled: true },
  { id: 'skill-badge', disabled: false },
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

const profileDir = join(home, 'profiles', 'spec')
await mkdir(profileDir, { recursive: true })
appBoot.initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
const profile = {
  name: 'spec', dir: profileDir, layers: [],
  patchPath: join(profileDir, 'cordis.patch.yml'), patches: [],
}
const resolution = await appBoot.createRuntimeResolution({ installAnchor: INSTALL_ANCHOR, home, profile })
const rootConfig = join(profileDir, 'cordis.yml')
await writeFile(rootConfig, '[]\n')
const webDir = join(repo, 'packages/bundle/web-app')
const webManifest = JSON.parse(await readFile(join(webDir, 'package.json'), 'utf8'))
const webPatches = appBoot.bundlePatchPaths(webDir, webManifest.dsh.bundle)
  .flatMap(path => appBoot.loadOverlayPatches('dsh-test', path))
const bundlePatches = [
  ...appBoot.loadOverlayPatches('dsh-test', BASE_PATCH),
  ...webPatches,
]
const ctx = await appBoot.boot('dsh-test', rootConfig, [...bundlePatches, ...overrides], async (bootCtx) => {
  bootCtx.provide('profileContext', {
    name: 'spec', dir: profileDir, patchPath: profile.patchPath,
    installAnchor: INSTALL_ANCHOR, home, cwd: home,
    startedBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    overlays: overrides, telemetryDisabledEnv: '1',
  })
  await bootCtx.plugin(appBoot.PluginPackages, { resolution })
  cmdline.provideCmdline(bootCtx, { args: [], exit: () => {} })
})

await mkdir(out, { recursive: true })

let commit = 'unknown'
try {
  commit = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim()
} catch { /* not a git checkout */ }

const meta = {
  fixtureCwd: FIXTURE_CWD,
  commit,
  capturedAt: new Date().toISOString(),
  dumps: {},
}

async function dumpAgent(label, agent) {
  const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
  const rendered = renderPrompt(assembly)
  await writeFile(join(out, `original-${label}.md`), rendered)
  await writeFile(join(out, `sections-${label}.json`), JSON.stringify(
    assembly.sections.map(section => ({ name: section.name, text: section.text })),
    null, 2,
  ) + '\n')
  await writeFile(join(out, `tools-${label}.json`), JSON.stringify(
    assembly.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
    null, 2,
  ) + '\n')
  meta.dumps[label] = {
    sections: assembly.sections.map(section => section.name),
    tools: assembly.tools.map(tool => tool.name),
    promptBytes: Buffer.byteLength(rendered),
  }
  return assembly
}

let dumpIndex = 0
async function withPreset(id, fn) {
  const handle = await ctx.agents.create({
    sessionId: SessionId(`dump-${id}-${dumpIndex++}`),
    meta: { cwd: FIXTURE_CWD },
    agentOptions: { provider: 'deepseek', model: 'deepseek-chat' },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, id).then(() => undefined),
  })
  try {
    await fn(handle.agent)
  } finally {
    await handle.dispose()
  }
}

for (const id of ['standard', 'ptc', 'cordis', 'minimal']) {
  await withPreset(id, async (agent) => {
    await dumpAgent(id, agent)
    if (id === 'minimal') return
    agent.session.append('plan/mode', { active: true })
    await dumpAgent(`${id}-plan`, agent)
  })
}

// A delegated child joins its parent's composition; dump what it assembles.
await withPreset('standard', async (parent) => {
  const child = await parent.ctx.agents.create({
    sessionId: SessionId('dump-subagent-standard'),
    meta: childSessionMeta(parent, 1, false),
    agentOptions: { provider: 'deepseek', model: 'deepseek-chat' },
    setup: (agentCtx) => { applyChildComposition(agentCtx, parent, {}) },
  })
  try {
    await dumpAgent('subagent-standard', child.agent)
  } finally {
    await child.dispose()
  }
})

await writeFile(join(out, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
await ctx.fiber.dispose()

for (const [label, info] of Object.entries(meta.dumps)) {
  console.log(`${label}: ${info.promptBytes} bytes, sections=[${info.sections.join(', ')}]`)
}
console.log(`commit: ${commit}`)
console.log(`dumped to ${out}`)
