/**
 * dsh-unrestricted host half: fuses the unrestricted execution mode into each
 * preset's ORIGINAL system prompt at assembly time, and provides version check
 * and self-update support for both DSH Web and DSH Desktop profiles.
 *
 * Mechanism (public interfaces only):
 * - A root `system-prompt/assemble` waterfall listener receives every agent's
 *   assembly (unscoped listeners pass the dsh-scope filter). When enabled, it
 *   fuses the preset's sections structurally: extending `deployment:persona-prefix`
 *   in place, inserting the `unrestricted:execution-mode` section right after the
 *   persona, and appending boundary notes to any present `plan:policy`,
 *   `tools:ptc-only`, or `tool:structured_output` sections. Tools, contexts,
 *   and variables pass through untouched; when disabled the listener returns
 *   `next()` verbatim, so the prompt is byte-identical to the unmodified harness.
 * - `minimal` registers its persona with `complete: true`, which the registry
 *   restores AFTER the waterfall, so waterfall edits cannot reach it. For
 *   minimal agents (joined, switched via `agent-preset/selected`, or later
 *   created) the plugin shadows `deployment:persona-prefix` at agent scope with
 *   a complete section carrying the fused minimal prompt, and disposes that
 *   shadow immediately if the blank session switches away to another preset.
 * - Rosterless profiles (such as `headless`, `acp`, or `sdk`) mount no
 *   `agentPresets` service; the plugin detects the active host composition
 *   (`ptc` when `tools:ptc-only` is present, otherwise `standard`) and fuses
 *   their assemblies directly.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  ANCHORS,
  PRESETS,
  PRESET_RULES,
  compareSemver,
  fuseSections,
  fusedMinimalPrompt,
  normalizeVersion,
  renderPreview,
} from './rules.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-unrestricted'

/** Current plugin package version. */
export const PLUGIN_VERSION = '0.2.6'

/** Canonical GitHub repository for release checks and git-based updates. */
export const GITHUB_REPO = 'yexi-by/dsh-unrestricted'

/** Services required by this plugin (all base-backed profiles provide these). */
export const inject = ['settings', 'systemPrompt', 'loader']

const RPC_CHANNEL = '/dsh-unrestricted'
const RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const RAW_PACKAGE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/master/package.json`
const JSDELIVR_PACKAGE_URL = `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@master/package.json`
const UPDATE_CHECK_TIMEOUT_MS = 10_000
const PNPM_TIMEOUT_MS = 120_000

export const Config = z.object({
  enabled: z.boolean().default(false),
}).default({ enabled: false }).volatile()

/** Human-readable error text for diagnostics and RPC error branches. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** RpcResult success branch. */
function ok(value) {
  return { ok: true, value }
}

/** Read and parse a JSON file, returning undefined when absent or unreadable. */
async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** Run pnpm inside a profile directory using Desktop's bundled runtime or system pnpm. */
function runPnpm(profileDir, args, packageManager) {
  const command = packageManager?.command ?? (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  const fullArgs = [
    ...(packageManager?.argsPrefix ?? []),
    '--dir',
    profileDir,
    '--config.confirmModulesPurge=false',
    ...args,
  ]
  const env = packageManager?.env !== undefined
    ? { ...process.env, ...packageManager.env }
    : process.env
  const useShell = packageManager?.command === undefined && process.platform === 'win32'
  return new Promise((resolve, reject) => {
    execFile(
      command,
      fullArgs,
      {
        cwd: profileDir,
        env,
        shell: useShell,
        windowsHide: true,
        timeout: PNPM_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = [stderr, stdout, error.message]
            .map(part => String(part ?? '').trim())
            .find(part => part.length > 0) ?? 'pnpm exited with an error'
          reject(new Error(detail))
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

/**
 * @param ctx - plugin context carrying settings, systemPrompt, loader, and
 *   optional agentPresets / connection / profileContext services.
 */
export function apply(ctx, config) {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))

  const state = {
    enabled: config.get().enabled,
    /** presetId -> issue codes observed on live assemblies. */
    runtime: new Map(),
    /** Agent -> section disposer for minimal persona shadows. */
    shadows: new Map(),
    /** Minimal agents whose persona was already registered at agent scope by caller. */
    customMinimal: new WeakSet(),
    /** Precomputed fused minimal prompt. */
    fusedMinimal: fusedMinimalPrompt(),
    /** presetId -> last successfully fused top-level live assembly (the deploy preview). */
    fusedText: new Map(),
    /** Latest update status snapshot. */
    update: {
      state: 'idle',
      currentVersion: PLUGIN_VERSION,
      restartRequired: false,
    },
    /** In-flight update check promise. */
    checkingUpdate: null,
    /** In-flight update installation promise. */
    performingUpdate: null,
  }

  /**
   * Read the standing assembly of a preset using the registry's scope lease
   * (DSH >= 0.2.1) or scope helper fallback (DSH 0.2.0-rc.2).
   * In rosterless profiles, assemble the global host layer directly.
   */
  async function presetAssembly(presetId) {
    await ctx.loader.await()
    const presets = ctx.get('agentPresets')
    if (presets === undefined) {
      return await ctx.systemPrompt.assemble({})
    }
    if (typeof presets.acquireScope === 'function') {
      const lease = await presets.acquireScope(presetId)
      try {
        return await ctx.systemPrompt.assemble({ scope: lease.key })
      } finally {
        await lease[Symbol.asyncDispose]()
      }
    }
    if (typeof presets.get === 'function') {
      const { createScope } = await import('@deepseek-ai/dsh-scope')
      const preset = presets.get(presetId)
      const { ctx: scopeCtx, key, dispose } = await createScope(
        ctx,
        'agent-preset',
        presetId,
        preset.plugin,
        preset.config,
      )
      try {
        await scopeCtx.loader.await()
        return await ctx.systemPrompt.assemble({ scope: key })
      } finally {
        await dispose()
      }
    }
    return await ctx.systemPrompt.assemble({})
  }

  /**
   * Remove a minimal persona shadow from an agent when it switches preset, is
   * disposed, or unrestricted mode turns off.
   */
  function unshadowMinimal(agent) {
    const dispose = state.shadows.get(agent)
    if (dispose === undefined) return
    state.shadows.delete(agent)
    dispose()
  }

  /**
   * Resolve the composed preset id for a live agent, or infer `ptc`/`standard`
   * when running in a rosterless profile (e.g. headless / sdk).
   */
  function resolveAgentPreset(agent, sections) {
    const presets = ctx.get('agentPresets')
    if (presets !== undefined) {
      try {
        return presets.composedPreset(agent.ctx)
      } catch {
        return undefined
      }
    }
    if (sections !== undefined) {
      return sections.some(s => s.name === 'tools:ptc-only' && s.text.trim() !== '')
        ? 'ptc'
        : 'standard'
    }
    return undefined
  }

  /**
   * Synchronize a minimal agent's complete persona shadow with its current
   * preset and toggle state. If the agent is no longer on `minimal`, any stale
   * shadow from an earlier blank-session preset selection is disposed.
   */
  function syncMinimalShadow(agent) {
    if (!state.enabled) {
      unshadowMinimal(agent)
      return
    }
    const presetId = resolveAgentPreset(agent)
    if (presetId !== 'minimal') {
      unshadowMinimal(agent)
      return
    }
    if (state.shadows.has(agent) || state.customMinimal.has(agent)) return
    let dispose
    try {
      dispose = agent.ctx.systemPrompt.section({
        name: 'deployment:persona-prefix',
        order: 0,
        complete: true,
        text: (context) => {
          const hasStructured = context?.agent?.ctx?.tools
            ?.schemas?.(context.agent)
            ?.some(tool => tool.name === 'structured_output') === true
          return hasStructured
            ? fusedMinimalPrompt(ANCHORS.structuredOutputFull)
            : state.fusedMinimal
        },
      })
    } catch (error) {
      if (messageOf(error) !== 'prompt section "deployment:persona-prefix" is already registered in this scope') throw error
      state.customMinimal.add(agent)
      return
    }
    state.shadows.set(agent, dispose)
    state.fusedText.set('minimal', state.fusedMinimal)
  }

  /** Synchronize minimal persona shadows across all live agents. */
  function sweepAgents() {
    const agents = ctx.get('agents')
    if (agents === undefined) return
    for (const agent of agents.list()) syncMinimalShadow(agent)
  }

  /** Drop every persona shadow (toggle off or plugin disposal). */
  function clearShadows() {
    for (const [, dispose] of state.shadows) dispose()
    state.shadows.clear()
  }

  function onEnable() {
    state.runtime.clear()
    sweepAgents()
    void ctx.loader.await().then(() => {
      if (state.enabled) sweepAgents()
    })
  }

  function onDisable() {
    clearShadows()
    state.runtime.clear()
    state.fusedText.clear()
  }

  /** Inspect how `dsh-unrestricted` is installed in the active profile. */
  async function inspectProfileInstall() {
    const profileContext = ctx.get('profileContext')
    const profileDir = profileContext?.dir
    if (typeof profileDir !== 'string' || profileDir === '') {
      return {
        profileDir: undefined,
        profileName: undefined,
        packageManager: undefined,
        installSource: 'unknown',
        dependencySpec: undefined,
        localSourceDir: undefined,
      }
    }
    const pkg = await readJsonFile(path.join(profileDir, 'package.json'))
    const spec = pkg?.dependencies?.[name]
    if (typeof spec !== 'string' || spec === '') {
      return {
        profileDir,
        profileName: profileContext?.name,
        packageManager: profileContext?.packageManager,
        installSource: 'unknown',
        dependencySpec: undefined,
        localSourceDir: undefined,
      }
    }
    if (spec.startsWith('file:') || spec.startsWith('link:')) {
      const prefix = spec.startsWith('file:') ? 'file:' : 'link:'
      const rawTarget = spec.slice(prefix.length)
      const localSourceDir = path.isAbsolute(rawTarget)
        ? rawTarget
        : path.resolve(profileDir, rawTarget)
      return {
        profileDir,
        profileName: profileContext?.name,
        packageManager: profileContext?.packageManager,
        installSource: 'file',
        dependencySpec: spec,
        localSourceDir,
      }
    }
    if (spec.startsWith('github:') || spec.includes('github.com')) {
      return {
        profileDir,
        profileName: profileContext?.name,
        packageManager: profileContext?.packageManager,
        installSource: 'github',
        dependencySpec: spec,
        localSourceDir: undefined,
      }
    }
    return {
      profileDir,
      profileName: profileContext?.name,
      packageManager: profileContext?.packageManager,
      installSource: 'registry',
      dependencySpec: spec,
      localSourceDir: undefined,
    }
  }

  /** Query GitHub Releases (with raw/jsDelivr fallback) for the latest published version. */
  async function fetchRemoteRelease() {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-unrestricted',
    }
    let lastError
    try {
      const response = await fetch(RELEASE_API_URL, {
        headers,
        signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
      })
      if (response.ok) {
        const data = await response.json()
        const version = normalizeVersion(data?.tag_name ?? data?.name)
        if (version !== undefined) {
          return {
            latestVersion: version,
            latestTag: typeof data.tag_name === 'string' && data.tag_name.trim() !== ''
              ? data.tag_name.trim()
              : `v${version}`,
            releaseUrl: typeof data.html_url === 'string' && data.html_url.trim() !== ''
              ? data.html_url.trim()
              : `https://github.com/${GITHUB_REPO}/releases/tag/v${version}`,
            publishedAt: typeof data.published_at === 'string' ? data.published_at : undefined,
          }
        }
      } else {
        lastError = new Error(`HTTP ${response.status}`)
      }
    } catch (error) {
      lastError = error
    }

    for (const fallbackUrl of [RAW_PACKAGE_URL, JSDELIVR_PACKAGE_URL]) {
      try {
        const response = await fetch(fallbackUrl, {
          headers: { Accept: 'application/json', 'User-Agent': 'dsh-unrestricted' },
          signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
        })
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`)
          continue
        }
        const pkg = await response.json()
        const version = normalizeVersion(pkg?.version)
        if (version !== undefined) {
          return {
            latestVersion: version,
            latestTag: `v${version}`,
            releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/v${version}`,
            publishedAt: undefined,
          }
        }
      } catch (error) {
        lastError = error
      }
    }

    throw lastError ?? new Error('Unable to reach GitHub release metadata')
  }

  /** Check whether a newer version is available from GitHub or the linked local directory. */
  async function checkUpdate({ force = false } = {}) {
    if (!force && state.checkingUpdate !== null) {
      return await state.checkingUpdate
    }
    const task = (async () => {
      const install = await inspectProfileInstall()
      let localVersion
      if (install.installSource === 'file' && install.localSourceDir !== undefined) {
        const localPkg = await readJsonFile(path.join(install.localSourceDir, 'package.json'))
        localVersion = normalizeVersion(localPkg?.version)
      }

      let remote = null
      let remoteError = null
      try {
        remote = await fetchRemoteRelease()
      } catch (error) {
        remoteError = error
      }

      if (remote === null && localVersion === undefined) {
        state.update = {
          ...state.update,
          state: 'failed',
          currentVersion: PLUGIN_VERSION,
          installSource: install.installSource,
          dependencySpec: install.dependencySpec,
          checkedAt: new Date().toISOString(),
          errorCode: 'update-check-failed',
          errorDetail: messageOf(remoteError),
        }
        return state.update
      }

      let latestVersion = remote?.latestVersion ?? localVersion
      let latestTag = remote?.latestTag ?? `v${latestVersion}`
      if (localVersion !== undefined && (latestVersion === undefined || compareSemver(localVersion, latestVersion) > 0)) {
        latestVersion = localVersion
        latestTag = `v${localVersion}`
      }

      const baselineVersion = state.update.restartRequired && state.update.updatedVersion !== undefined
        ? state.update.updatedVersion
        : PLUGIN_VERSION
      const hasNewer = compareSemver(latestVersion, baselineVersion) > 0

      state.update = {
        state: hasNewer
          ? 'available'
          : state.update.restartRequired
            ? 'updated'
            : 'up-to-date',
        currentVersion: PLUGIN_VERSION,
        latestVersion,
        latestTag,
        releaseUrl: remote?.releaseUrl ?? `https://github.com/${GITHUB_REPO}/releases`,
        publishedAt: remote?.publishedAt,
        checkedAt: new Date().toISOString(),
        installSource: install.installSource,
        dependencySpec: install.dependencySpec,
        restartRequired: Boolean(state.update.restartRequired),
        updatedVersion: state.update.updatedVersion,
      }
      return state.update
    })()

    state.checkingUpdate = task
    try {
      return await task
    } finally {
      if (state.checkingUpdate === task) {
        state.checkingUpdate = null
      }
    }
  }

  /** Install the latest version into the active profile and mark restartRequired. */
  async function performUpdate({ targetTag } = {}) {
    if (state.performingUpdate !== null) {
      return await state.performingUpdate
    }
    const task = (async () => {
      const install = await inspectProfileInstall()
      if (install.profileDir === undefined) {
        state.update = {
          ...state.update,
          state: 'failed',
          currentVersion: PLUGIN_VERSION,
          errorCode: 'update-no-profile',
        }
        return state.update
      }

      if (state.update.latestVersion === undefined && targetTag === undefined) {
        await checkUpdate({ force: true })
      }

      let targetSpec
      let expectedVersion = state.update.latestVersion

      if (install.installSource === 'file' && install.localSourceDir !== undefined) {
        const localPkg = await readJsonFile(path.join(install.localSourceDir, 'package.json'))
        const localVersion = normalizeVersion(localPkg?.version)
        if (localVersion === undefined) {
          state.update = {
            ...state.update,
            state: 'failed',
            currentVersion: PLUGIN_VERSION,
            installSource: install.installSource,
            dependencySpec: install.dependencySpec,
            errorCode: 'update-install-failed',
            errorDetail: `Cannot read package.json in ${install.localSourceDir}`,
          }
          return state.update
        }
        if (expectedVersion !== undefined && compareSemver(localVersion, expectedVersion) < 0) {
          state.update = {
            ...state.update,
            state: 'failed',
            currentVersion: PLUGIN_VERSION,
            installSource: install.installSource,
            dependencySpec: install.dependencySpec,
            errorCode: 'update-file-source-outdated',
            errorDetail: `${localVersion} < ${expectedVersion}`,
          }
          return state.update
        }
        targetSpec = install.dependencySpec
        expectedVersion = localVersion
      } else {
        const resolvedTag = typeof targetTag === 'string' && targetTag.trim() !== ''
          ? targetTag.trim()
          : (state.update.latestTag ?? (expectedVersion !== undefined ? `v${expectedVersion}` : 'master'))
        targetSpec = `github:${GITHUB_REPO}#${resolvedTag}`
        expectedVersion = normalizeVersion(resolvedTag) ?? expectedVersion ?? PLUGIN_VERSION
      }

      const pkgPath = path.join(install.profileDir, 'package.json')
      const lockPath = path.join(install.profileDir, 'pnpm-lock.yaml')
      const backupPkg = await fs.readFile(pkgPath, 'utf8').catch(() => undefined)
      const backupLock = await fs.readFile(lockPath, 'utf8').catch(() => undefined)
      const parsedBefore = backupPkg !== undefined ? JSON.parse(backupPkg) : undefined
      const originalDsh = parsedBefore?.dsh

      try {
        await runPnpm(install.profileDir, ['add', targetSpec], install.packageManager)

        // Ensure file: installs refresh cached store copies when needed.
        const installedPkgPath = path.join(install.profileDir, 'node_modules', name, 'package.json')
        let installedPkg = await readJsonFile(installedPkgPath)
        let installedVersion = normalizeVersion(installedPkg?.version)
        if (
          install.installSource === 'file'
          && expectedVersion !== undefined
          && installedVersion !== expectedVersion
        ) {
          await runPnpm(install.profileDir, ['remove', name], install.packageManager)
          await runPnpm(install.profileDir, ['add', targetSpec], install.packageManager)
          installedPkg = await readJsonFile(installedPkgPath)
          installedVersion = normalizeVersion(installedPkg?.version)
        }

        // Preserve dsh.profile.bundles in package.json after pnpm mutations.
        const afterPkg = await readJsonFile(pkgPath)
        if (afterPkg !== undefined) {
          const dshBlock = afterPkg.dsh ?? originalDsh ?? {}
          const profileBlock = dshBlock.profile ?? originalDsh?.profile ?? {}
          const bundles = Array.isArray(profileBlock.bundles)
            ? [...profileBlock.bundles]
            : Array.isArray(originalDsh?.profile?.bundles)
              ? [...originalDsh.profile.bundles]
              : []
          if (!bundles.includes(name)) bundles.push(name)
          afterPkg.dsh = {
            ...originalDsh,
            ...dshBlock,
            profile: {
              ...originalDsh?.profile,
              ...profileBlock,
              bundles,
            },
          }
          await fs.writeFile(pkgPath, `${JSON.stringify(afterPkg, null, 2)}\n`, 'utf8')
        }

        const finalVersion = installedVersion ?? expectedVersion ?? PLUGIN_VERSION
        state.update = {
          ...state.update,
          state: 'updated',
          currentVersion: PLUGIN_VERSION,
          latestVersion: finalVersion,
          latestTag: `v${finalVersion}`,
          updatedVersion: finalVersion,
          installSource: install.installSource,
          dependencySpec: targetSpec,
          checkedAt: new Date().toISOString(),
          restartRequired: true,
          errorCode: undefined,
          errorDetail: undefined,
        }
        return state.update
      } catch (error) {
        if (backupPkg !== undefined) {
          await fs.writeFile(pkgPath, backupPkg, 'utf8').catch(() => {})
        }
        if (backupLock !== undefined) {
          await fs.writeFile(lockPath, backupLock, 'utf8').catch(() => {})
        }
        state.update = {
          ...state.update,
          state: 'failed',
          currentVersion: PLUGIN_VERSION,
          installSource: install.installSource,
          dependencySpec: install.dependencySpec,
          errorCode: 'update-install-failed',
          errorDetail: messageOf(error),
        }
        return state.update
      }
    })()

    state.performingUpdate = task
    try {
      return await task
    } finally {
      if (state.performingUpdate === task) {
        state.performingUpdate = null
      }
    }
  }

  /** Current card view: toggle, version, per-preset state, and update state. */
  function statusPayload() {
    const modes = {}
    for (const presetId of PRESETS) {
      const issues = state.runtime.get(presetId) ?? []
      modes[presetId] = {
        state: !state.enabled
          ? 'off'
          : issues.length > 0 ? 'failed' : 'active',
        issues,
      }
    }
    return {
      enabled: state.enabled,
      version: PLUGIN_VERSION,
      modes,
      update: state.update,
    }
  }

  /** One line-count/byte summary so the preview reports size metadata. */
  function summarize(text) {
    return {
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      lines: text.split('\n').length,
    }
  }

  /**
   * Variables to bind in a standing-scope preview. When a live agent exists,
   * borrow its route and working directory so the card reads a realistic
   * prompt instead of raw slots.
   */
  function previewVariables() {
    const variables = {}
    try {
      const agents = ctx.get('agents')
      const agent = agents?.list?.()[0]
      if (agent !== undefined) {
        variables.provider = agent.options.provider
        variables.model = agent.options.model
        variables.cwd = agent.session.header.cwd
      }
    } catch {
      // No agent service or an unreadable session: literal slots are fine.
    }
    return variables
  }

  /**
   * Build the deploy preview for ONE preset from the same assembly path the
   * live fusion uses. Read-only — never mutates prompt state.
   */
  async function previewFor(presetId) {
    if (!PRESETS.includes(presetId)) {
      return {
        presetId,
        available: false,
        errorCode: 'unsupported-preset',
        reason: `unknown preset "${presetId}"`,
      }
    }
    const cached = state.fusedText.get(presetId)
    if (cached !== undefined) {
      return { presetId, available: true, source: 'live', ...summarize(cached) }
    }
    try {
      const assembly = await presetAssembly(presetId)
      const fused = presetId === 'minimal'
        ? { sections: [{ name: 'deployment:persona-prefix', text: fusedMinimalPrompt() }] }
        : fuseSections(assembly.sections, presetId)
      if (fused.issues !== undefined) {
        return {
          presetId,
          available: false,
          errorCode: 'missing-persona',
          reason: fused.issues.join('; '),
        }
      }
      const variables = { ...assembly.variables, ...previewVariables() }
      const text = renderPreview({ ...assembly, sections: fused.sections, variables }, renderPrompt)
      return { presetId, available: true, source: 'standing', ...summarize(text) }
    } catch (error) {
      return {
        presetId,
        available: false,
        errorCode: 'preview-failed',
        reason: messageOf(error),
      }
    }
  }

  /** RPC endpoint handler for the settings card. */
  async function handleRpc(endpoint, payload) {
    switch (endpoint) {
      case 'status': {
        return ok(statusPayload())
      }
      case 'preview': {
        const presetId = payload?.presetId ?? payload?.args?.presetId
        return ok(await previewFor(presetId))
      }
      case 'recheck': {
        state.runtime.clear()
        state.fusedText.clear()
        if (state.enabled) sweepAgents()
        return ok(statusPayload())
      }
      case 'check-update': {
        const force = Boolean(payload?.force ?? payload?.args?.force)
        return ok(await checkUpdate({ force }))
      }
      case 'perform-update': {
        const targetTag = payload?.targetTag ?? payload?.args?.targetTag
        return ok(await performUpdate({ targetTag }))
      }
      default:
        return {
          ok: false,
          error: {
            code: 'internal',
            message: `dsh-unrestricted: unknown endpoint ${JSON.stringify(endpoint)}`,
            details: {},
          },
        }
    }
  }

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const original = await next()
    if (!state.enabled) return original
    const agent = context.agent
    if (agent === undefined) return original
    const presetId = resolveAgentPreset(agent, original.sections)
    if (presetId === undefined || !PRESET_RULES[presetId]) {
      unshadowMinimal(agent)
      return original
    }
    if (presetId === 'minimal') {
      if (state.shadows.has(agent)) {
        state.fusedText.set('minimal', state.fusedMinimal)
        return original
      }
      syncMinimalShadow(agent)
      if (state.customMinimal.has(agent)) {
        const fused = fuseSections(original.sections, 'minimal', { isSubagent: true })
        if (fused.issues !== undefined) {
          state.runtime.set('minimal', fused.issues)
          return original
        }
        state.runtime.delete('minimal')
        return { ...original, sections: fused.sections }
      }
      return original
    }
    if (state.shadows.has(agent)) {
      unshadowMinimal(agent)
    }
    const isSubagent = original.contexts.some(entry => entry.name === 'subagent:delegation')
    const fused = fuseSections(original.sections, presetId, { isSubagent })
    if (fused.issues !== undefined) {
      state.runtime.set(presetId, fused.issues)
      return original
    }
    state.runtime.delete(presetId)
    if (!isSubagent) {
      try {
        state.fusedText.set(presetId, renderPreview({ ...original, sections: fused.sections }, renderPrompt))
      } catch {
        state.fusedText.delete(presetId)
      }
    }
    return { ...original, sections: fused.sections }
  })

  ctx.on('agent/created', ({ agent }) => {
    if (!state.enabled) return
    syncMinimalShadow(agent)
  })

  ctx.on('agent-preset/selected', (sessionId) => {
    const agent = ctx.get('agents')?.get?.(sessionId)
    if (agent === undefined) return
    state.customMinimal.delete(agent)
    if (!state.enabled) {
      unshadowMinimal(agent)
      return
    }
    syncMinimalShadow(agent)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    state.customMinimal.delete(agent)
    unshadowMinimal(agent)
  })

  ctx.effect(() => {
    const unwatch = ctx.on('loader/volatile-update', () => {
      const enabled = config.get().enabled
      if (enabled === state.enabled) return
      state.enabled = enabled
      if (enabled) onEnable()
      else onDisable()
    })
    if (state.enabled) onEnable()
    return () => {
      state.enabled = false
      unwatch()
      clearShadows()
    }
  }, 'dsh-unrestricted: toggle lifecycle')

  // Web/Desktop 状态通道由官方 Connection 认证；headless 组合无需提供 connection 服务。
  ctx.inject(['connection'], (connectionCtx) => {
    const disposeRpc = connectionCtx.connection.rpc.handle(RPC_CHANNEL, handleRpc)
    return async () => {
      await disposeRpc()
    }
  })
}
