/**
 * dsh-unrestricted host half: fuses the unrestricted execution mode into each
 * preset's ORIGINAL system prompt at assembly time and exposes read-only previews.
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
import z from '@deepseek-ai/schemastery'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  ANCHORS,
  PRESETS,
  PRESET_RULES,
  fuseSections,
  fusedMinimalPrompt,
  renderPreview,
} from './rules.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-unrestricted'

/** Current plugin package version. */
export const PLUGIN_VERSION = '0.2.7'

/** Services required by this plugin (all base-backed profiles provide these). */
export const inject = ['settings', 'systemPrompt', 'loader']

const RPC_CHANNEL = '/dsh-unrestricted'
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

/**
 * @param ctx - plugin context carrying settings, systemPrompt, loader, and
 *   optional agentPresets / connection services.
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

  /** Current card view: toggle, version, and per-preset state. */
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
