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
 *   minimal agents (joined or later created) the plugin shadows
 *   `deployment:persona-prefix` at agent scope with a complete section carrying the
 *   fused minimal prompt.
 * - Anchor failures (startup standing-scope check or any live assembly) leave
 *   that prompt unchanged and show the failed current-master invariant in the
 *   settings card.
 *
 * The toggle lives in the `unrestricted` settings namespace (persisted to
 * $DSH_HOME/settings.yaml). Switching affects the NEXT assembly of any live
 * or future agent — never an in-flight request or a logged session event.
 */
import z from '@deepseek-ai/schemastery'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  ANCHORS, PRESETS, PRESET_RULES, contractFingerprint, fuseSections, fusedMinimalPrompt, renderPreview,
} from './rules.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-unrestricted'

/** Services required by this plugin (all host-plane residents of the web profile). */
export const inject = ['settings', 'systemPrompt', 'agentPresets']

const RPC_CHANNEL = '/dsh-unrestricted'

const Section = z.object({
  enabled: z.boolean().default(false),
})

/** Human-readable error text for status and RPC error branches. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** RpcResult success branch. */
function ok(value) {
  return { ok: true, value }
}

/**
 * @param ctx - plugin context carrying settings, systemPrompt, agentPresets,
 *   connection, and the cordis Loader.
 */
export function apply(ctx) {
  const scope = ctx.settings.register('unrestricted', Section)

  const state = {
    enabled: scope.get().enabled,
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
    /** presetId -> last successfully fused live assembly (the deploy preview). */
    fusedText: new Map(),
  }

  /** All known issues for one preset (startup check + live observations). */
  function modeIssues(presetId) {
    return [...state.startup.get(presetId) ?? [], ...state.runtime.get(presetId) ?? []]
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
        const key = await ctx.agentPresets.standingKeyFor(presetId)
        const assembly = await ctx.systemPrompt.assemble({ scope: key })
        const fused = fuseSections(assembly.sections, presetId)
        if (fused.issues !== undefined) issues.push(...fused.issues)
        if (PRESET_RULES[presetId].plan) {
          const source = await ctx.agentPresets.read(presetId)
          if (!source.includes(ANCHORS.planPrefix)) issues.push('plan-mode section changed')
        }
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

  /** Check every preset once (status surface and the `recheck` endpoint). */
  function ensureChecks() {
    return Promise.all(PRESETS.map(presetId => ensureCheck(presetId)))
  }

  /** Whether one preset may currently be fused. */
  function usable(presetId) {
    return PRESETS.includes(presetId) && modeIssues(presetId).length === 0
  }

  /**
   * Shadow a minimal agent's complete persona with the fused prompt. No-op for
   * other presets, for unverified minimal anchors, or while disabled.
   * @param agent - the created agent (from `agent/created` or `agents.list()`).
   */
  function shadowMinimal(agent) {
    if (!state.enabled || state.fusedMinimal === null || state.shadows.has(agent)) return
    let presetId
    try {
      presetId = ctx.agentPresets.composedPreset(agent.ctx)
    } catch {
      return // scope chain not readable; leave the agent untouched
    }
    if (presetId !== 'minimal') return
    const dispose = agent.ctx.systemPrompt.section({
      name: 'deployment:persona-prefix',
      order: 0,
      complete: true,
      text: state.fusedMinimal,
    })
    state.shadows.set(agent, dispose)
  }

  /** Shadow every live minimal agent (called when the toggle flips on). */
  function sweepAgents() {
    const agents = ctx.get('agents')
    if (agents === undefined) return
    for (const agent of agents.list()) shadowMinimal(agent)
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
  }

  /** Current card view: toggle and per-preset state. */
  function statusPayload() {
    const modes = {}
    for (const presetId of PRESETS) {
      const issues = modeIssues(presetId)
      modes[presetId] = {
        state: !state.enabled
          ? 'off'
          : !state.startup.has(presetId)
            ? 'checking'
            : issues.length > 0 ? 'failed' : 'active',
        issues,
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
    if (!PRESETS.includes(presetId)) {
      return { presetId, contract, available: false, reason: `unknown preset "${presetId}"` }
    }
    // Best source first: the exact bytes a live agent just received. Only when
    // no agent has assembled this preset yet (the toggle is still off) does the
    // preview fall back to the standing scope, which carries no agent-bound
    // sections and leaves {{model}} / {{cwd}} as literal slots.
    const cached = state.fusedText.get(presetId)
    if (cached !== undefined) {
      return { presetId, contract, available: true, source: 'live', ...summarize(cached) }
    }
    try {
      const key = await ctx.agentPresets.standingKeyFor(presetId)
      const assembly = await ctx.systemPrompt.assemble({ scope: key })
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
      case 'status':
        return ok(statusPayload())
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
        return ok(statusPayload())
      }
      default:
        return { ok: false, error: { code: 'internal', message: `dsh-unrestricted: unknown endpoint ${JSON.stringify(endpoint)}`, details: {} } }
    }
  }

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const original = await next()
    if (!state.enabled) return original
    const agent = context.agent
    if (agent === undefined || state.shadows.has(agent)) return original
    let presetId
    try {
      presetId = ctx.agentPresets.composedPreset(agent.ctx)
    } catch {
      return original // scope chain unreadable; never break a request over it
    }
    if (presetId === undefined || !PRESET_RULES[presetId]) return original
    if (presetId === 'minimal') {
      // The complete-persona restore runs after this waterfall, so an agent
      // missed by the enable sweep (a request that raced the toggle) keeps its
      // original prompt for THIS assembly; registering the shadow now covers
      // its next assembly instead.
      await ensureCheck('minimal')
      shadowMinimal(agent)
      return original
    }
    if (!usable(presetId)) return original
    const isSubagent = original.contexts.some(entry => entry.name === 'subagent:delegation')
    const fused = fuseSections(original.sections, presetId, { isSubagent })
    if (fused.issues !== undefined) {
      state.runtime.set(presetId, fused.issues)
      return original
    }
    // Keep the deployed fusion available for the card's preview. Rendering is
    // display-only and never feeds back into the assembly returned to the loop.
    try {
      state.fusedText.set(presetId, renderPreview({ ...original, sections: fused.sections }, renderPrompt))
    } catch {
      state.fusedText.delete(presetId) // an unresolvable variable only costs the preview
    }
    return { ...original, sections: fused.sections }
  })

  ctx.on('agent/created', ({ agent }) => {
    if (!state.enabled) return
    // Only minimal's own check gates the shadow — never the other presets'.
    void ensureCheck('minimal').then(() => shadowMinimal(agent))
  })

  ctx.on('agent/disposed', ({ agent }) => {
    state.shadows.delete(agent)
  })

  ctx.effect(() => {
    const unwatch = scope.watch((next) => {
      const enabled = next.enabled
      if (enabled === state.enabled) return
      state.enabled = enabled
      if (enabled) onEnable()
      else onDisable()
    })
    if (state.enabled) onEnable()
    return () => {
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
