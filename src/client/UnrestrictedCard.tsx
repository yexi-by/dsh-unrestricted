/**
 * The unrestricted settings page: one persisted toggle, the per-preset fusion
 * state reported by the host half, and the deploy preview for the preset the
 * user is inspecting. The preset roster is whatever the host reports, so a
 * preset added after this build (a user-authored `adg`, or any future one)
 * appears here without a plugin change. All data arrives through the props
 * shares; the only component-local state is which preview is open.
 */
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings section slot contract.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { UnrestrictedCardInjected, UnrestrictedModeState } from './controller.ts'
import type { UnrestrictedLocaleKey } from './locales.ts'

/** Full component props assembled by the Settings slot renderer. */
export type UnrestrictedCardProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.unrestricted'>
  & InjectFace<UnrestrictedCardInjected>

/** One rendered mode row. */
interface ModeRow {
  id: string
  mode: UnrestrictedModeState | undefined
  /** Localized label for the four shipped presets; the preset's own name otherwise. */
  label: string
}

/** Shipped presets keep their localized labels and their display order. */
const KNOWN_LABELS: Readonly<Record<string, UnrestrictedLocaleKey>> = {
  standard: 'modeStandard',
  ptc: 'modePtc',
  cordis: 'modeCordis',
  minimal: 'modeMinimal',
}

/** Shipped order, so a roster read never reshuffles the four familiar rows. */
const KNOWN_ORDER = ['standard', 'ptc', 'cordis', 'minimal']

/** Known host issue strings mapped to localized dictionary keys. */
const ISSUE_LOCALE_KEYS: Readonly<Record<string, UnrestrictedLocaleKey>> = {
  'harness identity opening changed': 'issueIdentity',
  'preset persona changed': 'issuePersona',
  'plan-mode section changed': 'issuePlan',
  'ptc-mode run_code rule changed': 'issuePtcOnly',
  'structured-output instruction changed': 'issueStructuredOutput',
}

/** Locale key for one mode state. */
function stateKey(mode: UnrestrictedModeState | undefined): UnrestrictedLocaleKey {
  switch (mode?.state) {
    case 'active': return 'stateActive'
    case 'checking': return 'stateChecking'
    case 'failed': return 'stateValidationFailed'
    default: return 'stateOff'
  }
}

/**
 * Render the unrestricted settings page.
 * @param props - locale copy, the card snapshot, and its actions.
 * @returns the section body.
 */
export function UnrestrictedCard(props: UnrestrictedCardProps) {
  const { t, loadPreview } = props
  const view = props.useView(snapshot => snapshot)
  const status = view.status
  const [openPreview, setOpenPreview] = useState<string | null>(null)
  const openEntry = openPreview === null ? undefined : view.previews[openPreview]

  // When a refresh/recheck/toggle invalidates the preview map while a preview
  // drawer is open, automatically reload that preset's preview.
  useEffect(() => {
    if (openPreview !== null && openEntry === undefined) {
      void loadPreview(openPreview)
    }
  }, [openPreview, openEntry, loadPreview])

  const modes = status?.modes ?? {}
  const knownRows: ModeRow[] = KNOWN_ORDER
    .filter(id => modes[id] !== undefined)
    .map(id => ({ id, mode: modes[id], label: t(KNOWN_LABELS[id] as UnrestrictedLocaleKey) }))
  const customRows: ModeRow[] = Object.keys(modes)
    .filter(id => !KNOWN_ORDER.includes(id))
    .sort()
    .map(id => ({ id, mode: modes[id], label: modes[id]?.name ?? id }))
  const rows = [...knownRows, ...customRows]

  const hasFailedMode = Object.values(modes).some(mode => mode.state === 'failed')
  const summaryKey: UnrestrictedLocaleKey = view.settingsStatus === 'loading'
    ? 'summaryLoading'
    : view.settingsStatus === 'unavailable'
      ? 'summaryUnavailable'
      : hasFailedMode
        ? 'summaryValidationFailed'
        : view.enabled ? 'summaryEnabled' : 'summaryDisabled'
  const summaryState = view.settingsStatus === 'ready'
    ? hasFailedMode ? 'error' : view.enabled ? 'active' : 'off'
    : 'pending'

  /** Toggle one preset's preview, fetching the current bytes on first open. */
  function togglePreview(presetId: string): void {
    if (openPreview === presetId) {
      setOpenPreview(null)
      return
    }
    setOpenPreview(presetId)
    const entry = view.previews[presetId]
    if (entry === undefined || entry.status === 'failed') void props.loadPreview(presetId)
  }

  /** Localize known anchor issues; pass dynamic probe errors through as-is. */
  function formatIssues(issues: readonly string[]): string {
    return issues
      .map((issue) => {
        const key = ISSUE_LOCALE_KEYS[issue]
        return key !== undefined ? t(key) : issue
      })
      .join('; ')
  }

  return (
    <div className="dsh-unrestricted-card">
      <div className="dsh-unrestricted-head">
        <h3 className="dsh-unrestricted-title">{t('title')}</h3>
        <span className="dsh-unrestricted-summaryStatus" data-state={summaryState}>{t(summaryKey)}</span>
      </div>
      <div className="dsh-unrestricted-content">
        <p className="dsh-unrestricted-description">{t('description')}</p>
        <label className="dsh-unrestricted-toggle">
          <input
            type="checkbox"
            checked={view.enabled}
            disabled={!view.writable || view.settingsStatus !== 'ready' || view.busy}
            onChange={(event) => { void props.setEnabled(event.target.checked) }}
          />
          <span>{t('toggle')}</span>
        </label>
        {view.settingsStatus === 'loading' && (
          <p className="dsh-unrestricted-note">{t('settingsLoading')}</p>
        )}
        {view.settingsStatus === 'unavailable' && (
          <p className="dsh-unrestricted-note">{t('settingsUnavailable')}</p>
        )}
        {view.message !== undefined && (
          <p className="dsh-unrestricted-error">{t('operationFailed')}{view.message}</p>
        )}
        <h4 className="dsh-unrestricted-statusTitle">{t('statusTitle')}</h4>
        <ul className="dsh-unrestricted-modes">
          {rows.map((row) => {
            const entry = view.previews[row.id]
            const isOpen = openPreview === row.id
            return (
              <li key={row.id} className="dsh-unrestricted-mode">
                <span className="dsh-unrestricted-dot" data-state={row.mode?.state ?? 'off'} />
                <span className="dsh-unrestricted-modeName">{row.label}</span>
                <span className="dsh-unrestricted-modeState">{t(stateKey(row.mode))}</span>
                <code className="dsh-unrestricted-presetId" title={t('modeIdLabel')}>{row.id}</code>
                {row.mode?.broken !== undefined && (
                  <span className="dsh-unrestricted-issues">{row.mode.broken}</span>
                )}
                <button
                  type="button"
                  className="dsh-unrestricted-inlineAction"
                  onClick={() => { togglePreview(row.id) }}
                >
                  {t(isOpen ? 'hidePreview' : 'showPreview')}
                </button>
                {row.mode !== undefined && row.mode.issues.length > 0 && (
                  <span className="dsh-unrestricted-issues">{formatIssues(row.mode.issues)}</span>
                )}
                {isOpen && (
                  <div className="dsh-unrestricted-preview">
                    {entry === undefined || entry.status === 'loading' ? (
                      <p className="dsh-unrestricted-note">{t('previewLoading')}</p>
                    ) : entry.status === 'failed' ? (
                      <p className="dsh-unrestricted-error">
                        {t('previewUnavailable')}{entry.message}
                      </p>
                    ) : entry.preview?.available === false ? (
                      <p className="dsh-unrestricted-error">
                        {t('previewUnavailable')}{entry.preview.reason}
                      </p>
                    ) : (
                      <>
                        <p className="dsh-unrestricted-note">
                          {entry.preview?.lines} {t('previewSize')} · {entry.preview?.bytes} B
                          {entry.preview?.source !== undefined && (
                            <> · {t(entry.preview.source === 'live' ? 'previewSourceLive' : 'previewSourceStanding')}</>
                          )}
                        </p>
                        <pre className="dsh-unrestricted-previewText">{entry.preview?.text}</pre>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <h4 className="dsh-unrestricted-statusTitle">{t('preflightTitle')}</h4>
        <p className="dsh-unrestricted-note">
          {t('fingerprint')} <code className="dsh-unrestricted-fingerprint">{status?.contract ?? '—'}</code>
        </p>
        <p className="dsh-unrestricted-note">{t('fingerprintNote')}</p>
        <p className="dsh-unrestricted-note">{t('subagentNote')}</p>
        <p className="dsh-unrestricted-note">{t('scopeNote')}</p>
        <div className="dsh-unrestricted-actions">
          <button type="button" disabled={view.busy} onClick={() => { void props.recheck() }}>{t('recheck')}</button>
          <button type="button" disabled={view.busy} onClick={() => { void props.refresh() }}>{t('refresh')}</button>
        </div>
      </div>
    </div>
  )
}
