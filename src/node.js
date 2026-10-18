/**
 * dsh-unrestricted host half: fuses the unrestricted execution mode into each
 * preset's ORIGINAL system prompt at assembly time.
 *
 * Mechanism (public interfaces only):
 * - A root `system-prompt/assemble` waterfall listener receives every agent's
 *   assembly (unscoped listeners pass the dsh-scope filter). When enabled, it
 *   verifies the anchors of the agent's preset against the live sections and
 *   returns the same section list with the persona extended in place, the
 *   execution-mode section inserted behind the persona, and boundary notes
 *   appended to the plan / PTC-only / structured-output sections. Tools,
 *   contexts, and variables pass through untouched; when disabled the
 *   listener returns `next()` verbatim, so the prompt is byte-identical to
 *   the unmodified harness.
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
 * - Anchor failures (startup standing-scope check or any live assembly) leave
 *   that prompt unchanged and show the failed current-master invariant in the
 *   settings card.
 *
 * The toggle lives in the `unrestricted` settings namespace (persisted to
 * $DSH_HOME/profiles/web/cordis.patch.yml). Switching affects the NEXT assembly of any live
 * or future agent — never an in-flight request or a logged session event.
 */
import { loadHost, readEnabled } from './host.js'
import {
  ANCHORS, PRESETS, contractFingerprint, fuseSections, fusedMinimalPrompt, isKnownPreset, renderPreview,
} from './rules.js'

// Host packages are resolved through the running DSH entry, never through this
// bundle's own `node_modules` (a `link:` install has none). See ./host.js.
const z = loadHost('@deepseek-ai/schemastery')
const systemPromptModule = loadHost('@deepseek-ai/dsh-system-prompt')
const scopeModule = loadHost('@deepseek-ai/dsh-scope')

/**
 * Fallback renderer used only when `@deepseek-ai/dsh-system-prompt` cannot be
 * resolved: joins sections and substitutes the variables that do have values,
 * leaving the rest as literal `{{name}}`. Previews degrade; nothing else does.
 */
function fallbackRender(assembly) {
  return (assembly.sections ?? [])
    .map((section) => {
      if (section.interpolate === false) return section.text
      return String(section.text).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (whole, name) => {
        const value = assembly.variables?.[name]
        return typeof value === 'string' ? value : whole
      })
    })
    .filter((text) => text.length > 0)
    .join('\n\n')
}

const renderPrompt = systemPromptModule?.renderPrompt ?? fallbackRender

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-unrestricted'

/** Services required by this plugin (all base-backed profiles provide these). */
export const inject = ['settings', 'systemPrompt', 'loader']

const RPC_CHANNEL = '/dsh-unrestricted'

/**
 * The volatile `enabled` flag. Built only when schemastery resolves: without it
 * the plugin still runs, but the Settings form and live toggling are absent.
 */
export const Config = typeof z?.object === 'function'
  ? z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }).volatile()
  : undefined

/** Human-readable error text for status and RPC error branches. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** RpcResult success branch. */
function ok(value) {
  return { ok: true, value }
}

/**
 * @param ctx - plugin context carrying settings, systemPrompt, loader, and
 *   optional agentPresets / connection services.
 */
export function apply(ctx, config) {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))

  const state = {
    enabled: readEnabled(config),
    /** presetId -> issue strings; a preset with an empty list is verified. */
    startup: new Map(),
    /** presetId -> in-flight startup check. */
    checking: new Map(),
    /** presetId -> issue strings observed on live assemblies. */
    runtime: new Map(),
    /** Agent -> section disposer for minimal persona shadows. */
    shadows: new Map(),
    /** Fused minimal prompt, computed only after the minimal anchors verify. */
    fusedMinimal: null,
    /** presetId -> last successfully fused top-level live assembly (the deploy preview). */
    fusedText: new Map(),
  }

  /** All known issues for one preset (startup check + live observations). */
  function modeIssues(presetId) {
    return [...state.startup.get(presetId) ?? [], ...state.runtime.get(presetId) ?? []]
  }

  /**
   * Read the standing assembly of a preset using the registry's scope lease
   * (or a temporary mounted scope fallback). In rosterless profiles, assemble
   * the global host layer directly.
   */
  async function presetAssembly(presetId) {
    // 预设声明与本插件是并列 Loader 条目；服务可用时，声明仍可能尚未注册。
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
    const createScope = scopeModule?.createScope
    if (typeof createScope !== 'function') {
      // No scope primitive available: probe the standing global assembly.
      return await ctx.systemPrompt.assemble({})
    }
    const key = {}
    const scope = createScope(ctx, key)
    try {
      await presets.mount(scope.ctx, presetId)
      return await ctx.systemPrompt.assemble({ scope: key })
    } finally {
      await scope.dispose()
    }
  }

  /**
   * Enumerate every preset this profile can run, so the card and the checks
   * cover presets added after this build (a user-authored `adg`, or any future
   * preset) instead of the four ids compiled into {@link PRESETS}.
   * @returns rows of `{ id, name, known }`, the shipped ids first.
   */
  async function presetRoster() {
    const rows = new Map()
    for (const id of PRESETS) rows.set(id, { id, name: undefined, known: true })
    const presets = ctx.get('agentPresets')
    if (presets !== undefined && typeof presets.list === 'function') {
      try {
        await ctx.loader.await()
        for (const preset of await presets.list()) {
          rows.set(preset.id, {
            id: preset.id,
            name: preset.name ?? preset.description,
            known: isKnownPreset(preset.id),
            broken: preset.broken,
          })
        }
      } catch {
        // A roster read is a convenience; the shipped ids still fuse.
      }
    }
    return [...rows.values()]
  }

  /** All preset ids currently in the roster (shipped ids always included). */
  async function presetIds() {
    return (await presetRoster()).map(row => row.id)
  }

  /**
   * Run the standing-scope anchor check for ONE preset (lazy per-preset, so a
   * minimal toggle never waits on the other three mounts). Idempotent per
   * preset until `recheck` clears it.
   */
  function ensureCheck(presetId) {
    let pending = state.checking.get(presetId)
    if (pending !== undefined) return pending
    pending = (async () => {
      const issues = []
      try {
        await ctx.loader.await()
        const presets = ctx.get('agentPresets')
        if (presets === undefined) {
          // Rosterless profile (e.g. headless / sdk): live assembly checks the
          // host sections directly.
          state.startup.set(presetId, issues)
          return
        }
        const assembly = await presetAssembly(presetId)
        const fused = fuseSections(assembly.sections, presetId)
        if (fused.issues !== undefined) issues.push(...fused.issues)
      } catch (error) {
        issues.push(`preset probe failed: ${messageOf(error)}`)
      }
      state.startup.set(presetId, issues)
      if (presetId === 'minimal') {
        state.fusedMinimal = issues.length === 0 ? fusedMinimalPrompt() : null
      }
    })().catch((error) => {
      state.startup.set(presetId, [`preset probe failed: ${messageOf(error)}`])
      if (presetId === 'minimal') state.fusedMinimal = null
    })
    state.checking.set(presetId, pending)
    return pending
  }

  /** Check every preset in the roster once (status surface and `recheck`). */
  async function ensureChecks() {
    await Promise.all((await presetIds()).map(presetId => ensureCheck(presetId)))
  }

  /**
   * Whether one preset may currently be fused. Every preset id is fusible —
   * unknown ids use the generic rule — so this only reports a failed check.
   */
  function usable(presetId) {
    return state.startup.has(presetId) && modeIssues(presetId).length === 0
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
        return undefined // scope chain not readable; leave the agent untouched
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
   * @param agent - the target agent.
   */
  function syncMinimalShadow(agent) {
    if (!state.enabled || state.fusedMinimal === null) {
      unshadowMinimal(agent)
      return
    }
    const presetId = resolveAgentPreset(agent)
    if (presetId !== 'minimal') {
      unshadowMinimal(agent)
      return
    }
    if (state.shadows.has(agent)) return
    const dispose = agent.ctx.systemPrompt.section({
      name: 'deployment:persona-prefix',
      order: 0,
      complete: true,
      text: (context) => {
        // Preserve structured-output instructions when a structured subagent
        // runs under minimal.
        const hasStructured = context?.agent?.ctx?.tools
          ?.schemas?.()
          ?.some(tool => tool.name === 'structured_output') === true
        return hasStructured
          ? fusedMinimalPrompt(ANCHORS.structuredOutputFull)
          : (state.fusedMinimal ?? fusedMinimalPrompt())
      },
    })
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
    void ensureChecks() // fills the status surface in the background
    // The sweep only needs minimal's own check — don't gate it on the rest.
    void ensureCheck('minimal').then(() => sweepAgents())
  }

  function onDisable() {
    clearShadows()
    state.fusedText.clear()
  }

  /** Current card view: toggle and per-preset state (roster-driven). */
  async function statusPayload() {
    const modes = {}
    for (const row of await presetRoster()) {
      const issues = modeIssues(row.id)
      modes[row.id] = {
        state: !state.enabled
          ? 'off'
          : !state.startup.has(row.id)
            ? 'checking'
            : issues.length > 0 ? 'failed' : 'active',
        issues,
        name: row.name,
        known: row.known,
        broken: row.broken,
      }
    }
    return { enabled: state.enabled, contract: contractFingerprint(), modes }
  }

  /** One line-count/byte summary so the preview does not ship a whole prompt. */
  function summarize(text) {
    return {
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      lines: text.split('\n').length,
    }
  }

  /**
   * Variables to bind in a standing-scope preview. The standing scope carries
   * no agent, so its `{{model}}` / `{{cwd}}` providers resolve to nothing; when
   * a live agent exists, borrow its route and working directory so the card
   * reads a realistic prompt instead of raw slots. Absent any agent the slots
   * stay literal, which the card renders as-is.
   * @returns partial variable overrides for the preview assembly.
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
   * live fusion uses. This is the "look before you switch" surface: exact
   * fused prompt text, its size, and the contract fingerprint it embeds.
   * Read-only — it never mutates prompt state.
   * @param presetId - preset id from the card.
   * @returns the preview payload, or a message naming why none is available.
   */
  async function previewFor(presetId) {
    const contract = contractFingerprint()
    if (typeof presetId !== 'string' || presetId === '') {
      return { presetId, contract, available: false, reason: 'missing preset id' }
    }
    // Best source first: the exact bytes a top-level live agent just received.
    // Only when no top-level agent has assembled this preset yet does the
    // preview fall back to the standing scope, which carries no agent-bound
    // sections and leaves {{model}} / {{cwd}} as literal slots.
    const cached = state.fusedText.get(presetId)
    if (cached !== undefined) {
      return { presetId, contract, available: true, source: 'live', ...summarize(cached) }
    }
    try {
      const assembly = await presetAssembly(presetId)
      const fused = presetId === 'minimal'
        ? { sections: [{ name: 'deployment:persona-prefix', text: fusedMinimalPrompt() }] }
        : fuseSections(assembly.sections, presetId)
      if (fused.issues !== undefined) {
        return { presetId, contract, available: false, reason: fused.issues.join('; ') }
      }
      const variables = { ...assembly.variables, ...previewVariables() }
      const text = renderPreview({ ...assembly, sections: fused.sections, variables }, renderPrompt)
      return { presetId, contract, available: true, source: 'standing', ...summarize(text) }
    } catch (error) {
      return { presetId, contract, available: false, reason: `preview probe failed: ${messageOf(error)}` }
    }
  }

  /** RPC endpoint handler for the settings card. */
  async function handleRpc(endpoint, payload) {
    switch (endpoint) {
      case 'status': {
        if (state.enabled) await ensureChecks()
        return ok(await statusPayload())
      }
      case 'preview': {
        // Private channels forward the client payload verbatim; accept the
        // `{ args }` envelope too so this handler survives a caller that
        // follows the gateway convention.
        const presetId = payload?.presetId ?? payload?.args?.presetId
        return ok(await previewFor(presetId))
      }
      case 'recheck': {
        state.checking.clear()
        state.startup.clear()
        state.runtime.clear()
        state.fusedText.clear()
        await ensureChecks()
        if (state.enabled) sweepAgents()
        return ok(await statusPayload())
      }
      default:
        return { ok: false, error: { code: 'internal', message: `dsh-unrestricted: unknown endpoint ${JSON.stringify(endpoint)}`, details: {} } }
    }
  }

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const original = await next()
    if (!state.enabled) return original
    const agent = context.agent
    if (agent === undefined) return original
    const presetId = resolveAgentPreset(agent, original.sections)
    if (presetId === undefined) {
      unshadowMinimal(agent)
      return original
    }
    if (presetId === 'minimal') {
      // If the minimal shadow is already installed on this agent, `assemble()`
      // will restore the complete persona right after the waterfall returns;
      // record the live preview text and let it finish.
      if (state.shadows.has(agent) && state.fusedMinimal !== null) {
        state.fusedText.set('minimal', state.fusedMinimal)
        return original
      }
      // An agent missed by the enable sweep (a request that raced the toggle)
      // registers its shadow now for subsequent assemblies, and also returns
      // the fused minimal section for this assembly when possible.
      await ensureCheck('minimal')
      syncMinimalShadow(agent)
      return original
    }
    // If this blank session was previously `minimal` and switched to another
    // preset before its first turn, drop the stale minimal shadow now so it
    // cannot overwrite the new preset's sections after the waterfall.
    if (state.shadows.has(agent)) {
      unshadowMinimal(agent)
    }
    if (!usable(presetId)) return original
    const isSubagent = original.contexts.some(entry => entry.name === 'subagent:delegation')
    const fused = fuseSections(original.sections, presetId, { isSubagent })
    if (fused.issues !== undefined) {
      state.runtime.set(presetId, fused.issues)
      return original
    }
    // Keep the deployed top-level fusion available for the card's preview.
    // Subagents may carry custom personas or restricted sections, so they do
    // not overwrite the preset's top-level preview cache.
    if (!isSubagent) {
      try {
        state.fusedText.set(presetId, renderPreview({ ...original, sections: fused.sections }, renderPrompt))
      } catch {
        state.fusedText.delete(presetId) // an unresolvable variable only costs the preview
      }
    }
    return { ...original, sections: fused.sections }
  })

  ctx.on('agent/created', ({ agent }) => {
    if (!state.enabled) return
    // Only minimal's own check gates the shadow — never the other presets'.
    void ensureCheck('minimal').then(() => syncMinimalShadow(agent))
  })

  ctx.on('agent-preset/selected', (sessionId) => {
    const agent = ctx.get('agents')?.get?.(sessionId)
    if (agent === undefined) return
    if (!state.enabled) {
      unshadowMinimal(agent)
      return
    }
    void ensureCheck('minimal').then(() => syncMinimalShadow(agent))
  })

  ctx.on('agent/disposed', ({ agent }) => {
    unshadowMinimal(agent)
  })

  ctx.effect(() => {
    const unwatch = ctx.on('loader/volatile-update', () => {
      const enabled = readEnabled(config)
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

  // Web 状态通道由官方 Connection 认证；headless 组合无需提供 connection 服务。
  ctx.inject(['connection'], (connectionCtx) => {
    const disposeRpc = connectionCtx.connection.rpc.handle(RPC_CHANNEL, handleRpc)
    return async () => {
      await disposeRpc()
    }
  })
}
