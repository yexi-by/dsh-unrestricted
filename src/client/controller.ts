/**
 * Browser-half controller for the unrestricted card: binds the `unrestricted`
 * settings namespace (the toggle), reads per-preset fusion state and previews,
 * and manages version checks and self-updates via the host half's private RPC.
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
}

/** Per-preset fusion state reported by the host half. */
export interface UnrestrictedModeState {
  state: 'off' | 'active' | 'failed'
  issues: string[]
}

/** Version and update status reported by the host half. */
export interface UnrestrictedUpdateInfo {
  state: 'idle' | 'checking' | 'up-to-date' | 'available' | 'updating' | 'updated' | 'failed'
  currentVersion: string
  latestVersion?: string
  latestTag?: string
  updatedVersion?: string
  releaseUrl?: string
  publishedAt?: string
  checkedAt?: string
  installSource?: 'github' | 'file' | 'registry' | 'unknown'
  dependencySpec?: string
  restartRequired?: boolean
  errorCode?: string
  errorDetail?: string
}

/** Host status endpoint payload. */
export interface UnrestrictedStatus {
  enabled: boolean
  /** Current plugin version reported by the host half. */
  version?: string
  modes: Record<string, UnrestrictedModeState>
  update?: UnrestrictedUpdateInfo
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
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Settings scope sync state. */
  settingsStatus: 'loading' | 'ready' | 'unavailable'
  /** Live host status; null until the first RPC answer. */
  status: UnrestrictedStatus | null
  /** Version and update check state. */
  update: UnrestrictedUpdateInfo
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

/** Inject face handed to the card and detail badge at registration. */
export interface UnrestrictedCardInjected {
  hooks: {
    /** Reactive card view. */
    view: UnrestrictedViewSource
  }
  /** Persist the toggle. */
  setEnabled: (enabled: boolean) => Promise<void>
  /** Re-validate runtime state and refresh. */
  recheck: () => Promise<void>
  /** Re-read host status and invalidate cached previews. */
  refresh: () => Promise<void>
  /** Fetch the exact fused prompt this preset would deploy. */
  loadPreview: (presetId: string) => Promise<void>
  /** Check whether a newer plugin version is available. */
  checkUpdate: (force?: boolean) => Promise<void>
  /** Download and install the latest version into the active profile. */
  performUpdate: () => Promise<void>
}

const RPC_CHANNEL = '/dsh-unrestricted'
const SETTINGS_NS = 'unrestricted'
const DEFAULT_VERSION = '0.2.6'

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
    writable: false,
    settingsStatus: 'loading',
    status: null,
    update: {
      state: 'idle',
      currentVersion: DEFAULT_VERSION,
      restartRequired: false,
    },
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
    if (enabled !== snapshot.enabled) invalidatePreviews()
    snapshot = {
      enabled,
      writable: settingsSnapshot.writable,
      settingsStatus: settingsSnapshot.status,
      status: snapshot.status,
      update: snapshot.update,
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
    const result = await connection.rpc.call(RPC_CHANNEL, endpoint, payload) as RpcResult<T>
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
        const nextUpdate = status.update !== undefined
          && (snapshot.update.state === 'idle' || status.update.state !== 'idle')
          ? status.update
          : {
              ...snapshot.update,
              currentVersion: status.version ?? snapshot.update.currentVersion,
            }
        snapshot = {
          ...snapshot,
          status,
          update: nextUpdate,
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

  function setEnabled(enabled: boolean): Promise<void> {
    return whileBusy(async () => {
      try {
        await settings.set('enabled', enabled)
        await refresh(true)
      } catch (error) {
        snapshot = { ...snapshot, message: messageOf(error) }
      }
    })
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

  /**
   * Check whether a newer version is available from GitHub or the local source directory.
   * @param force - bypass in-flight reuse and force a fresh check.
   */
  async function checkUpdate(force = false): Promise<void> {
    if (snapshot.update.state === 'checking' || snapshot.update.state === 'updating') return
    snapshot = {
      ...snapshot,
      update: { ...snapshot.update, state: 'checking', errorCode: undefined, errorDetail: undefined },
    }
    publish()
    try {
      const update = await call<UnrestrictedUpdateInfo>('check-update', { force })
      snapshot = { ...snapshot, update }
    } catch (error) {
      snapshot = {
        ...snapshot,
        update: {
          ...snapshot.update,
          state: 'failed',
          errorCode: 'update-check-failed',
          errorDetail: messageOf(error),
        },
      }
    }
    publish()
  }

  /**
   * Download and install the latest version into the active profile.
   */
  async function performUpdate(): Promise<void> {
    if (snapshot.update.state === 'updating') return
    snapshot = {
      ...snapshot,
      update: { ...snapshot.update, state: 'updating', errorCode: undefined, errorDetail: undefined },
    }
    publish()
    try {
      const update = await call<UnrestrictedUpdateInfo>('perform-update', {
        targetTag: snapshot.update.latestTag,
      })
      snapshot = { ...snapshot, update }
    } catch (error) {
      snapshot = {
        ...snapshot,
        update: {
          ...snapshot.update,
          state: 'failed',
          errorCode: 'update-install-failed',
          errorDetail: messageOf(error),
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
      recheck,
      refresh: () => refresh(true),
      loadPreview,
      checkUpdate,
      performUpdate,
    }),
  }
}
