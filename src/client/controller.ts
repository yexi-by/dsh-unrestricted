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
// Type-only: the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** The toggle section stored in the `unrestricted` settings namespace. */
export interface UnrestrictedSettings {
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
}

/** Full view snapshot the card subscribes to. */
export interface UnrestrictedViewSnapshot {
  /** Persisted toggle; undefined until the settings scope first syncs. */
  enabled: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Settings scope sync state. */
  settingsStatus: 'loading' | 'ready' | 'unavailable'
  /** Live host status; null until the first RPC answer. */
  status: UnrestrictedStatus | null
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
  /** Re-run the host-side anchor checks and refresh. */
  recheck: () => Promise<void>
  /** Re-read host status. */
  refresh: () => Promise<void>
}

const RPC_CHANNEL = '/dsh-unrestricted'
const SETTINGS_NS = 'unrestricted'

/** Human-readable error text for the banner. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Create the card controller bound to the calling plugin's context.
 * @param ctx - the browser plugin context (connection + remote + settingsScope injected).
 * @returns the controller whose face() feeds the slot inject share.
 */
export function createUnrestrictedController(ctx: Context) {
  const connection = ctx.get('connection') as ConnectionHandle
  const settings = ctx.settingsScope.bind<UnrestrictedSettings>({ namespace: SETTINGS_NS })

  let snapshot: UnrestrictedViewSnapshot = {
    enabled: false,
    writable: false,
    settingsStatus: 'loading',
    status: null,
  }
  const listeners = new Set<() => void>()

  const view: UnrestrictedViewSource = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  function publish(): void {
    const settingsSnapshot = settings.getSnapshot()
    snapshot = {
      enabled: settingsSnapshot.value?.enabled === true,
      writable: settingsSnapshot.writable,
      settingsStatus: settingsSnapshot.status,
      status: snapshot.status,
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
      snapshot = { ...snapshot, status, message: undefined }
      publish()
    } catch (error) {
      snapshot = { ...snapshot, message: messageOf(error) }
      publish()
    }
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    await settings.set('enabled', enabled)
    publish()
    // Give the host settings watcher one turn before reading its derived state.
    setTimeout(() => void refresh(), 300)
  }

  async function recheck(): Promise<void> {
    try {
      const status = await call<UnrestrictedStatus>('recheck', {})
      snapshot = { ...snapshot, status, message: undefined }
      publish()
    } catch (error) {
      snapshot = { ...snapshot, message: messageOf(error) }
      publish()
    }
  }

  ctx.effect(
    () => settings.subscribe(publish),
    'dsh-unrestricted: settings mirror',
  )
  // External settings.yaml edits commit through the settings service, which
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
    face: (): UnrestrictedCardInjected => ({ hooks: { view }, setEnabled, recheck, refresh }),
  }
}
