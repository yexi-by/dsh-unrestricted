/**
 * Browser-half controller for the unrestricted card: binds the `unrestricted`
 * settings namespace (the toggle) and polls the host half's private RPC for
 * per-preset fusion state. Mirrors the card-controller pattern: the apply
 * closure owns the controller, the slot inject face hands hooks and callbacks
 * to the component.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the ctx.configForms Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MODULE_IDS, MODULE_GROUPS, DEFAULT_MODULES, resolveModules, type ModuleId, type ModuleSettings, type EnableGroup } from '../module-config.js'

/** The toggle section stored in the `unrestricted` settings namespace. */
export interface UnrestrictedSettings extends Partial<ModuleSettings> {
  enabled?: boolean
}

/** Per-preset fusion state reported by the host half. */
export interface UnrestrictedModeState {
  state: 'off' | 'checking' | 'active' | 'failed'
  issues: string[]
}

/** Host status endpoint payload. */
export interface UnrestrictedStatus {
  enabled: boolean
  modes: Record<string, UnrestrictedModeState>
  modules: Array<{ id: ModuleId; enabled: boolean; characters: number; bytes: number }>
  usage: { characters: number; bytes: number; fullCharacters: number; savedCharacters: number }
}

/** Deploy preview for one preset: what switching on would actually assemble. */
export interface UnrestrictedPreview {
  presetId: string
  available: boolean
  /** `live` = bytes a live agent received; `standing` = preset scope, no agent bound. */
  source?: 'live' | 'standing'
  /** Fused prompt text; present when available. */
  text?: string
  bytes?: number
  lines?: number
  addedCharacters?: number
  addedBytes?: number
  /** Why no preview could be built; present when unavailable. */
  reason?: string
}

/** One fetched preview, keyed by preset, plus its in-flight/error state. */
export interface UnrestrictedPreviewEntry {
  status: 'loading' | 'ready' | 'failed'
  preview?: UnrestrictedPreview
  message?: string
}

/** Full view snapshot the card subscribes to. */
export interface UnrestrictedViewSnapshot {
  /** Persisted toggle; undefined until the settings scope first syncs. */
  enabled: boolean
  modules: ModuleSettings
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Settings scope sync state. */
  settingsStatus: 'loading' | 'ready' | 'unavailable'
  /** Live host status; null until the first RPC answer. */
  status: UnrestrictedStatus | null
  /** presetId -> fetched deploy preview. */
  previews: Record<string, UnrestrictedPreviewEntry>
  /** Last transport/business failure, if any. */
  message?: string
}

/** Minimal RPC wire shape (structural copy of the host RpcResult). */
type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** Minimal observable contract consumed by the slot renderer's hook binding. */
export interface UnrestrictedViewSource {
  getSnapshot(): UnrestrictedViewSnapshot
  subscribe(listener: () => void): () => void
}

/** Inject face handed to the card at registration. */
export interface UnrestrictedCardInjected {
  hooks: {
    /** Reactive card view. */
    view: UnrestrictedViewSource
  }
  /** Persist the toggle. */
  setEnabled: (enabled: boolean) => Promise<void>
  setModule: (id: ModuleId, enabled: boolean) => Promise<void>
  /** Open one group in a single native mutation, preserving every other choice. */
  enableModules: (group: EnableGroup) => Promise<void>
  /** Re-run the host-side anchor checks and refresh. */
  recheck: () => Promise<void>
  /** Re-read host status. */
  refresh: () => Promise<void>
  /** Fetch the exact fused prompt this preset would deploy. */
  loadPreview: (presetId: string) => Promise<void>
}

const RPC_CHANNEL = '/dsh-unrestricted'
const SETTINGS_NS = 'unrestricted'

/** Human-readable error text for the banner. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Create the card controller bound to the calling plugin's context.
 * @param ctx - the browser plugin context (connection + remote + configForms injected).
 * @returns the controller whose face() feeds the slot inject share.
 */
export function createUnrestrictedController(ctx: Context) {
  const connection = ctx.get('connection') as ConnectionHandle
  const settings = ctx.configForms.get<UnrestrictedSettings>(SETTINGS_NS)

  let snapshot: UnrestrictedViewSnapshot = {
    enabled: false,
    modules: { ...DEFAULT_MODULES },
    writable: false,
    settingsStatus: 'loading',
    status: null,
    previews: {},
  }
  const listeners = new Set<() => void>()
  let previewGeneration = 0

  const view: UnrestrictedViewSource = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  function publish(): void {
    const settingsSnapshot = settings.getSnapshot()
    const enabled = settingsSnapshot.value?.enabled === true
    const modules = resolveModules(settingsSnapshot.value)
    const changed = enabled !== snapshot.enabled || MODULE_IDS.some(id => modules[id] !== snapshot.modules[id])
    if (changed) previewGeneration++
    snapshot = {
      enabled,
      modules,
      writable: settingsSnapshot.writable,
      settingsStatus: settingsSnapshot.status,
      status: snapshot.status,
      previews: changed ? {} : snapshot.previews,
      message: snapshot.message,
    }
    for (const listener of listeners) listener()
  }

  async function call<T>(endpoint: string, payload: unknown): Promise<T> {
    const result = await connection.rpc.call(RPC_CHANNEL, endpoint, payload) as RpcResult<T>
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  async function refresh(): Promise<void> {
    try {
      const status = await call<UnrestrictedStatus>('status', {})
      previewGeneration++
      snapshot = { ...snapshot, status, previews: {}, message: undefined }
      publish()
    } catch (error) {
      snapshot = { ...snapshot, message: messageOf(error) }
      publish()
    }
  }

  async function setField(field: 'enabled' | ModuleId, enabled: boolean): Promise<void> {
    try {
      await settings.set(field, enabled)
      publish()
      // Give the host volatile watcher one turn before reading its derived state.
      setTimeout(() => void refresh(), 300)
    } catch (error) {
      snapshot = { ...snapshot, message: messageOf(error) }
      publish()
    }
  }

  const setEnabled = (enabled: boolean) => setField('enabled', enabled)
  const setModule = (id: ModuleId, enabled: boolean) => setField(id, enabled)

  async function enableModules(group: EnableGroup): Promise<void> {
    try {
      const ids = group === 'all' ? MODULE_IDS : MODULE_GROUPS[group]
      const accepted = await settings.mutate(ids.map(id => ({ op: 'set', path: [id], value: true })))
      if (!accepted) throw new Error('Module switches were not saved')
      publish()
      setTimeout(() => void refresh(), 300)
    } catch (error) {
      snapshot = { ...snapshot, message: messageOf(error) }
      publish()
    }
  }

  async function recheck(): Promise<void> {
    try {
      const status = await call<UnrestrictedStatus>('recheck', {})
      // Reject previews still in flight from before the recheck.
      previewGeneration++
      snapshot = { ...snapshot, status, previews: {}, message: undefined }
      publish()
    } catch (error) {
      snapshot = { ...snapshot, message: messageOf(error) }
      publish()
    }
  }

  /**
   * Fetch one preset's deploy preview. The card renders the raw fused prompt,
   * so the user reads the exact bytes before switching the mode on.
   * @param presetId - preset id from the card's row.
   */
  async function loadPreview(presetId: string): Promise<void> {
    const generation = previewGeneration
    snapshot = {
      ...snapshot,
      previews: { ...snapshot.previews, [presetId]: { status: 'loading' } },
    }
    publish()
    try {
      const preview = await call<UnrestrictedPreview>('preview', { presetId })
      if (generation !== previewGeneration) return
      snapshot = {
        ...snapshot,
        previews: { ...snapshot.previews, [presetId]: { status: 'ready', preview } },
      }
    } catch (error) {
      if (generation !== previewGeneration) return
      snapshot = {
        ...snapshot,
        previews: { ...snapshot.previews, [presetId]: { status: 'failed', message: messageOf(error) } },
      }
    }
    publish()
  }

  ctx.effect(
    () => settings.subscribe(publish),
    'dsh-unrestricted: settings mirror',
  )
  // External profile configuration edits commit through the settings service, which
  // forwards one document event per commit regardless of namespace.
  ctx.effect(
    () => ctx.remote.$on('settings/document-updated', (namespace?: string) => {
      if (namespace === undefined || namespace === SETTINGS_NS) void refresh()
    }),
    'dsh-unrestricted: settings invalidations',
  )

  publish()
  void refresh()
  return {
    face: (): UnrestrictedCardInjected => ({
      hooks: { view }, setEnabled, setModule, enableModules, recheck, refresh, loadPreview,
    }),
  }
}
