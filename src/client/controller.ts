/**
 * Browser-half controller for the unrestricted card: binds the `unrestricted`
 * settings namespace (the toggle) and reads per-preset state and previews.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the ctx.configForms Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** The toggle section stored in the `unrestricted` settings namespace. */
export interface UnrestrictedSettings {
  enabled?: boolean
  stripHostIdentity?: boolean
  customPrompt?: string
}

/** Per-preset fusion state reported by the host half. */
export interface UnrestrictedModeState {
  state: 'off' | 'active' | 'failed'
  issues: string[]
}

/** Host status endpoint payload. */
export interface UnrestrictedStatus {
  enabled: boolean
  stripHostIdentity?: boolean
  /** Persisted custom execution-mode prompt override, empty when using built-in default. */
  customPrompt?: string
  /** Built-in default execution-mode prompt text owned by the host half. */
  defaultPrompt?: string
  /** Whether a non-default custom execution-mode prompt is currently active. */
  isCustomPrompt?: boolean
  /** Current plugin version reported by the host half. */
  version?: string
  modes: Record<string, UnrestrictedModeState>
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
  /** Structured error code when unavailable. */
  errorCode?: string
  /** Diagnostic reason when unavailable. */
  reason?: string
}

/** One fetched preview, keyed by preset, plus its in-flight/error state. */
export interface UnrestrictedPreviewEntry {
  status: 'loading' | 'ready' | 'failed'
  preview?: UnrestrictedPreview
  errorCode?: string
  message?: string
}

/** Full view snapshot the card subscribes to. */
export interface UnrestrictedViewSnapshot {
  /** Persisted toggle; false until the settings scope first syncs. */
  enabled: boolean
  /** Persisted host-brand stripping toggle; false until synced. */
  stripHostIdentity: boolean
  /** Persisted custom prompt override (LF-normalized); empty when using built-in default. */
  customPrompt: string
  /** Built-in default execution-mode prompt text returned by the host status RPC. */
  defaultPrompt: string
  /** Whether a custom execution-mode prompt is currently overriding the default. */
  isCustomPrompt: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Settings scope sync state. */
  settingsStatus: 'loading' | 'ready' | 'unavailable'
  /** Live host status; null until the first RPC answer. */
  status: UnrestrictedStatus | null
  /** presetId -> fetched deploy preview. */
  previews: Record<string, UnrestrictedPreviewEntry>
  /** Whether a settings write or status refresh is in flight. */
  busy: boolean
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
  /** Persist whether host identity branding is stripped from prompts. */
  setStripHostIdentity: (strip: boolean) => Promise<void>
  /** Persist a user-edited execution-mode prompt (clears override when equal to default). */
  setCustomPrompt: (prompt: string) => Promise<boolean>
  /** Clear any custom prompt override and restore the built-in default. */
  resetCustomPrompt: () => Promise<boolean>
  /** Re-validate runtime state and refresh. */
  recheck: () => Promise<void>
  /** Re-read host status and invalidate cached previews. */
  refresh: () => Promise<void>
  /** Fetch the exact fused prompt this preset would deploy. */
  loadPreview: (presetId: string) => Promise<void>
}

const RPC_CHANNEL = '/api'
const RPC_NAMESPACE = 'dsh-unrestricted'
const SETTINGS_NS = 'unrestricted'

/** Normalize line endings so YAML/browser values compare identically across OSes. */
function normalizePromptText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : ''
}

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
    stripHostIdentity: false,
    customPrompt: '',
    defaultPrompt: '',
    isCustomPrompt: false,
    writable: false,
    settingsStatus: 'loading',
    status: null,
    previews: {},
    busy: false,
  }
  const listeners = new Set<() => void>()
  const previewRequests = new Map<string, symbol>()
  let statusGeneration = 0
  let pendingOperations = 0

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
    const stripHostIdentity = settingsSnapshot.value?.stripHostIdentity === true
    const customPrompt = normalizePromptText(settingsSnapshot.value?.customPrompt)
    const defaultPrompt = normalizePromptText(snapshot.status?.defaultPrompt)
    const isCustomPrompt = customPrompt.trim() !== '' && (defaultPrompt === '' || customPrompt !== defaultPrompt)
    if (
      enabled !== snapshot.enabled
      || stripHostIdentity !== snapshot.stripHostIdentity
      || customPrompt !== snapshot.customPrompt
    ) {
      invalidatePreviews()
    }
    snapshot = {
      enabled,
      stripHostIdentity,
      customPrompt,
      defaultPrompt,
      isCustomPrompt,
      writable: settingsSnapshot.writable,
      settingsStatus: settingsSnapshot.status,
      status: snapshot.status,
      previews: snapshot.previews,
      busy: pendingOperations > 0,
      message: snapshot.message,
    }
    for (const listener of listeners) listener()
  }

  function invalidatePreviews(): void {
    previewRequests.clear()
    snapshot = { ...snapshot, previews: {} }
  }

  async function call<T>(endpoint: string, payload: unknown): Promise<T> {
    const result = await connection.rpc.call(
      RPC_CHANNEL,
      `${RPC_NAMESPACE}/${endpoint}`,
      payload,
    ) as RpcResult<T>
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  async function whileBusy(action: () => Promise<void>): Promise<void> {
    pendingOperations++
    publish()
    try {
      await action()
    } finally {
      pendingOperations--
      publish()
    }
  }

  function readStatus(endpoint: 'status' | 'recheck', clearPreviews: boolean): Promise<void> {
    const generation = ++statusGeneration
    return whileBusy(async () => {
      try {
        const status = await call<UnrestrictedStatus>(endpoint, {})
        if (generation !== statusGeneration) return
        if (clearPreviews) invalidatePreviews()
        snapshot = {
          ...snapshot,
          status,
          message: undefined,
        }
      } catch (error) {
        if (generation !== statusGeneration) return
        snapshot = { ...snapshot, message: messageOf(error) }
      }
    })
  }

  function refresh(clearPreviews = false): Promise<void> {
    return readStatus('status', clearPreviews)
  }

  async function updateSetting<K extends keyof UnrestrictedSettings>(
    field: K,
    value: NonNullable<UnrestrictedSettings[K]>,
  ): Promise<boolean> {
    let accepted = false
    await whileBusy(async () => {
      try {
        accepted = (await settings.set(field, value)) !== false
        await refresh(true)
      } catch (error) {
        snapshot = { ...snapshot, message: messageOf(error) }
        accepted = false
      }
    })
    return accepted
  }

  async function clearCustomPrompt(): Promise<boolean> {
    let accepted = false
    await whileBusy(async () => {
      try {
        const result = typeof settings.unset === 'function'
          ? await settings.unset('customPrompt')
          : await settings.set('customPrompt', '')
        accepted = result !== false
        await refresh(true)
      } catch (error) {
        snapshot = { ...snapshot, message: messageOf(error) }
        accepted = false
      }
    })
    return accepted
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    await updateSetting('enabled', enabled)
  }

  async function setStripHostIdentity(strip: boolean): Promise<void> {
    await updateSetting('stripHostIdentity', strip)
  }

  function setCustomPrompt(prompt: string): Promise<boolean> {
    const normalized = normalizePromptText(prompt)
    const defaultPrompt = normalizePromptText(snapshot.status?.defaultPrompt)
    if (normalized.trim() === '' || (defaultPrompt !== '' && normalized === defaultPrompt)) {
      return clearCustomPrompt()
    }
    return updateSetting('customPrompt', normalized)
  }

  function resetCustomPrompt(): Promise<boolean> {
    return clearCustomPrompt()
  }

  function recheck(): Promise<void> {
    return readStatus('recheck', true)
  }

  /**
   * Fetch one preset's deploy preview.
   * @param presetId - preset id from the card's row.
   */
  async function loadPreview(presetId: string): Promise<void> {
    const request = Symbol(presetId)
    previewRequests.set(presetId, request)
    snapshot = {
      ...snapshot,
      previews: { ...snapshot.previews, [presetId]: { status: 'loading' } },
    }
    publish()
    try {
      const preview = await call<UnrestrictedPreview>('preview', { presetId })
      if (previewRequests.get(presetId) !== request) return
      snapshot = {
        ...snapshot,
        previews: { ...snapshot.previews, [presetId]: { status: 'ready', preview } },
      }
    } catch (error) {
      if (previewRequests.get(presetId) !== request) return
      snapshot = {
        ...snapshot,
        previews: {
          ...snapshot.previews,
          [presetId]: {
            status: 'failed',
            errorCode: 'preview-failed',
            message: messageOf(error),
          },
        },
      }
    }
    publish()
  }

  ctx.effect(
    () => settings.subscribe(publish),
    'dsh-unrestricted: settings mirror',
  )
  ctx.effect(
    () => ctx.remote.$on('settings/document-updated', (namespace?: string) => {
      if (namespace === undefined || namespace === SETTINGS_NS) void refresh(true)
    }),
    'dsh-unrestricted: settings invalidations',
  )

  publish()
  void refresh()
  return {
    face: (): UnrestrictedCardInjected => ({
      hooks: { view },
      setEnabled,
      setStripHostIdentity,
      setCustomPrompt,
      resetCustomPrompt,
      recheck,
      refresh: () => refresh(true),
      loadPreview,
    }),
  }
}
