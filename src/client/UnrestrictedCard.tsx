/**
 * The unrestricted settings view and plugin-detail badge:
 * - Master toggle card with native Switch, status Tag, and scope boundary notes
 * - Per-preset coverage list with StateDot, Tag, preview drawer, and one-click copy
 * - Version & Updates card with automatic release check and one-click self-update
 */
import { useEffect, useState } from 'react'
import {
  Button,
  StateDot,
  Switch,
  Tag,
  fileSizeText,
  writeClipboard,
  type StateDotState,
  type TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {
  UnrestrictedCardInjected,
  UnrestrictedModeState,
  UnrestrictedPreviewEntry,
  UnrestrictedUpdateInfo,
} from './controller.ts'
import type { UnrestrictedLocaleKey } from './locales.ts'

/** Full component props assembled by the Settings slot renderer. */
export type UnrestrictedCardProps =
  PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'settings.unrestricted'>
  & InjectFace<UnrestrictedCardInjected>

/** Detail badge props assembled by the Plugin Manager header slot renderer. */
export type UnrestrictedDetailBadgeProps =
  PropsRuntime<'plugins.detail.badge'>
  & PropsLocale<'settings.unrestricted'>
  & InjectFace<UnrestrictedCardInjected>

/** Mode rows in display order, with their locale label and description keys. */
const MODE_ROWS: ReadonlyArray<{
  id: string
  labelKey: UnrestrictedLocaleKey
  descKey: UnrestrictedLocaleKey
  presetKey: UnrestrictedLocaleKey
}> = [
  { id: 'standard', labelKey: 'modeStandard', descKey: 'modeStandardDesc', presetKey: 'presetStandard' },
  { id: 'ptc', labelKey: 'modePtc', descKey: 'modePtcDesc', presetKey: 'presetPtc' },
  { id: 'cordis', labelKey: 'modeCordis', descKey: 'modeCordisDesc', presetKey: 'presetCordis' },
  { id: 'minimal', labelKey: 'modeMinimal', descKey: 'modeMinimalDesc', presetKey: 'presetMinimal' },
]

/** Known host issue strings/codes mapped to localized dictionary keys. */
const ISSUE_LOCALE_KEYS: Readonly<Record<string, UnrestrictedLocaleKey>> = {
  'missing-persona': 'issuePersona',
  'preset persona changed': 'issuePersona',
}

/** Locale key for one mode state. */
function stateKey(mode: UnrestrictedModeState | undefined): UnrestrictedLocaleKey {
  switch (mode?.state) {
    case 'active': return 'stateActive'
    case 'failed': return 'stateValidationFailed'
    default: return 'stateOff'
  }
}

/** Map mode state to native StateDot state. */
function dotStateOf(mode: UnrestrictedModeState | undefined): StateDotState {
  switch (mode?.state) {
    case 'active': return 'done'
    case 'failed': return 'error'
    default: return 'idle'
  }
}

/** Map mode state to native Tag tone. */
function modeTagTone(mode: UnrestrictedModeState | undefined): TagTone {
  switch (mode?.state) {
    case 'active': return 'success'
    case 'failed': return 'danger'
    default: return 'neutral'
  }
}

/** Friendly localized text for top-level RPC or settings errors. */
function localizeBannerError(message: string, t: (key: UnrestrictedLocaleKey) => string): string {
  const lower = message.toLowerCase()
  if (lower.includes('disconnect') || lower.includes('closed') || lower.includes('network') || lower.includes('timeout')) {
    return t('errorRpcDisconnected')
  }
  return `${t('operationFailed')}${message}`
}

/** Friendly localized text for preview failures. */
function localizePreviewError(
  entry: UnrestrictedPreviewEntry,
  t: (key: UnrestrictedLocaleKey) => string,
): string {
  const code = entry.preview?.errorCode ?? entry.errorCode
  if (code === 'unsupported-preset') return t('errorUnsupportedPreset')
  if (code === 'missing-persona') return t('errorMissingPersona')
  if (code === 'preview-failed') return t('errorPreviewFailed')
  const detail = entry.preview?.reason ?? entry.message
  return detail !== undefined && detail.trim() !== ''
    ? `${t('previewUnavailable')}${detail}`
    : t('errorPreviewFailed')
}

/** Friendly localized text for update errors. */
function localizeUpdateError(
  update: UnrestrictedUpdateInfo,
  t: (key: UnrestrictedLocaleKey) => string,
): string {
  switch (update.errorCode) {
    case 'update-check-failed':
      return t('errorUpdateCheckFailed')
    case 'update-no-profile':
      return t('errorUpdateNoProfile')
    case 'update-file-source-outdated':
      return t('errorUpdateFileOutdated')
    case 'update-install-failed':
      return `${t('errorUpdateInstallFailed')}${update.errorDetail ?? ''}`
    default:
      return update.errorDetail !== undefined && update.errorDetail !== ''
        ? `${t('operationFailed')}${update.errorDetail}`
        : t('errorUpdateCheckFailed')
  }
}

/** Friendly label for the installation source. */
function installSourceLabel(
  source: UnrestrictedUpdateInfo['installSource'],
  t: (key: UnrestrictedLocaleKey) => string,
): string {
  switch (source) {
    case 'github': return t('sourceGithub')
    case 'file': return t('sourceFile')
    case 'registry': return t('sourceRegistry')
    default: return t('sourceUnknown')
  }
}

/**
 * Badge shown in the Plugin Manager detail header when an update is available
 * or waiting for a restart.
 */
export function UnrestrictedDetailBadge(props: UnrestrictedDetailBadgeProps) {
  const { subject, t, checkUpdate } = props
  const update = props.useView(snapshot => snapshot.update)
  const isTargetBundle = subject.kind === 'bundle' && subject.pkg.name === 'dsh-unrestricted'

  useEffect(() => {
    if (isTargetBundle && update.state === 'idle') {
      void checkUpdate(false)
    }
  }, [isTargetBundle, update.state, checkUpdate])

  if (!isTargetBundle) return null
  if (update.state === 'available') {
    const versionSuffix = update.latestVersion !== undefined ? ` v${update.latestVersion}` : ''
    return <Tag tone="info">{`${t('updateBadge')}${versionSuffix}`}</Tag>
  }
  if (update.state === 'updated' || update.restartRequired === true) {
    return <Tag tone="success">{t('updateRestartBadge')}</Tag>
  }
  return null
}

/**
 * Render the unrestricted configuration cards.
 */
export function UnrestrictedCard(props: UnrestrictedCardProps) {
  const { t, loadPreview, checkUpdate } = props
  const view = props.useView(snapshot => snapshot)
  const status = view.status
  const update = view.update
  const [openPreview, setOpenPreview] = useState<string | null>(null)
  const [copiedPreset, setCopiedPreset] = useState<string | null>(null)
  const openEntry = openPreview === null ? undefined : view.previews[openPreview]

  // Automatically check for updates once when the configuration view opens.
  useEffect(() => {
    if (update.state === 'idle') {
      void checkUpdate(false)
    }
  }, [update.state, checkUpdate])

  // When a refresh/toggle invalidates the preview map while a preview drawer
  // is open, automatically reload that preset's preview.
  useEffect(() => {
    if (openPreview !== null && openEntry === undefined) {
      void loadPreview(openPreview)
    }
  }, [openPreview, openEntry, loadPreview])

  const hasFailedMode = status !== null
    && Object.values(status.modes).some(mode => mode.state === 'failed')
  const summaryKey: UnrestrictedLocaleKey = view.settingsStatus === 'loading'
    ? 'summaryLoading'
    : view.settingsStatus === 'unavailable'
      ? 'summaryUnavailable'
      : hasFailedMode
        ? 'summaryValidationFailed'
        : view.enabled ? 'summaryEnabled' : 'summaryDisabled'
  const summaryTone: TagTone = view.settingsStatus !== 'ready'
    ? 'neutral'
    : hasFailedMode
      ? 'warning'
      : view.enabled ? 'success' : 'neutral'

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

  /** Copy one preset's preview prompt text to the clipboard. */
  async function handleCopyPreview(presetId: string, text: string | undefined): Promise<void> {
    if (text === undefined || text === '') return
    const accepted = await writeClipboard(text)
    if (!accepted) return
    setCopiedPreset(presetId)
    setTimeout(() => {
      setCopiedPreset(current => (current === presetId ? null : current))
    }, 1800)
  }

  /** Localize known issues; fall back gracefully. */
  function formatIssues(issues: readonly string[]): string {
    return issues
      .map((issue) => {
        const key = ISSUE_LOCALE_KEYS[issue]
        return key !== undefined ? t(key) : issue
      })
      .join('；')
  }

  const updateBusy = update.state === 'checking' || update.state === 'updating'
  const updateTagTone: TagTone = update.state === 'available'
    ? 'info'
    : update.state === 'updated'
      ? 'success'
      : update.state === 'failed'
        ? 'danger'
        : 'neutral'
  const updateTagKey: UnrestrictedLocaleKey = update.state === 'checking'
    ? 'updateChecking'
    : update.state === 'updating'
      ? 'updateInstalling'
      : update.state === 'available'
        ? 'updateAvailable'
        : update.state === 'updated'
          ? 'updateRestartBadge'
          : update.state === 'up-to-date'
            ? 'updateUpToDate'
            : 'updateIdle'

  return (
    <div className="dsh-unrestricted-root" aria-busy={view.busy || updateBusy}>
      {/* Card 1: Master Toggle */}
      <section className="dsh-unrestricted-card" aria-labelledby="dsh-unrestricted-main-title">
        <div className="dsh-unrestricted-header">
          <div className="dsh-unrestricted-headerTitle">
            <h3 id="dsh-unrestricted-main-title" className="dsh-unrestricted-title">{t('title')}</h3>
            <Tag tone={summaryTone}>{t(summaryKey)}</Tag>
          </div>
          <div className="dsh-unrestricted-headerControls">
            <span className="dsh-unrestricted-switchLabel">{t('toggle')}</span>
            <Switch
              checked={view.enabled}
              disabled={!view.writable || view.settingsStatus !== 'ready' || view.busy}
              label={t('toggle')}
              onChange={(checked) => { void props.setEnabled(checked) }}
            />
          </div>
        </div>
        <p className="dsh-unrestricted-description">{t('description')}</p>
        <p className="dsh-unrestricted-note">{t('scopeNote')}</p>
        {view.settingsStatus === 'loading' && (
          <p className="dsh-unrestricted-note" role="status">{t('settingsLoading')}</p>
        )}
        {view.settingsStatus === 'unavailable' && (
          <p className="dsh-unrestricted-banner" data-tone="info" role="status">{t('settingsUnavailable')}</p>
        )}
        {view.message !== undefined && (
          <p className="dsh-unrestricted-banner" data-tone="error" role="alert">
            {localizeBannerError(view.message, t)}
          </p>
        )}
      </section>

      {/* Card 2: Mode Coverage & Prompt Previews */}
      <section className="dsh-unrestricted-card" aria-labelledby="dsh-unrestricted-modes-title">
        <div className="dsh-unrestricted-header">
          <div className="dsh-unrestricted-headerTitle">
            <h4 id="dsh-unrestricted-modes-title" className="dsh-unrestricted-subtitle">{t('statusTitle')}</h4>
          </div>
          <div className="dsh-unrestricted-headerControls">
            <Button
              variant="outline"
              size="sm"
              disabled={view.busy}
              onClick={() => { void props.refresh() }}
            >
              {t('refresh')}
            </Button>
          </div>
        </div>
        <p className="dsh-unrestricted-note">{t('statusSubtitle')}</p>

        <ul className="dsh-unrestricted-modes">
          {MODE_ROWS.map((row) => {
            const mode = status?.modes[row.id]
            const entry = view.previews[row.id]
            const isOpen = openPreview === row.id
            const previewText = entry?.preview?.text
            return (
              <li key={row.id} className="dsh-unrestricted-mode">
                <div className="dsh-unrestricted-modeMain">
                  <div className="dsh-unrestricted-modeInfo">
                    <div className="dsh-unrestricted-modeHeading">
                      <StateDot state={dotStateOf(mode)} />
                      <span className="dsh-unrestricted-modeName">{t(row.labelKey)}</span>
                      <Tag tone="outline">
                        <span className="dsh-unrestricted-mono">{t(row.presetKey)}</span>
                      </Tag>
                      <Tag tone={modeTagTone(mode)}>{t(stateKey(mode))}</Tag>
                    </div>
                    <p className="dsh-unrestricted-modeDesc">{t(row.descKey)}</p>
                  </div>
                  <div className="dsh-unrestricted-headerControls">
                    <Button
                      variant={isOpen ? 'toolbar' : 'outline'}
                      size="sm"
                      onClick={() => { togglePreview(row.id) }}
                    >
                      {t(isOpen ? 'hidePreview' : 'showPreview')}
                    </Button>
                  </div>
                </div>

                {mode !== undefined && mode.issues.length > 0 && (
                  <p className="dsh-unrestricted-issues">{formatIssues(mode.issues)}</p>
                )}

                {isOpen && (
                  <div className="dsh-unrestricted-preview">
                    {entry === undefined || entry.status === 'loading' ? (
                      <p className="dsh-unrestricted-note" role="status">{t('previewLoading')}</p>
                    ) : entry.status === 'failed' || entry.preview?.available === false ? (
                      <p className="dsh-unrestricted-banner" data-tone="error" role="alert">
                        {localizePreviewError(entry, t)}
                      </p>
                    ) : (
                      <>
                        <div className="dsh-unrestricted-previewHeader">
                          <p className="dsh-unrestricted-previewMeta">
                            {entry.preview?.lines} {t('previewSize')}
                            {entry.preview?.bytes !== undefined && ` · ${fileSizeText(entry.preview.bytes)}`}
                            {entry.preview?.source !== undefined && (
                              ` · ${t(entry.preview.source === 'live' ? 'previewSourceLive' : 'previewSourceStanding')}`
                            )}
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { void handleCopyPreview(row.id, previewText) }}
                          >
                            {t(copiedPreset === row.id ? 'copiedPreview' : 'copyPreview')}
                          </Button>
                        </div>
                        <pre className="dsh-unrestricted-previewText">{previewText}</pre>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <p className="dsh-unrestricted-note">{t('subagentNote')}</p>
      </section>

      {/* Card 3: Version & Updates */}
      <section className="dsh-unrestricted-card" aria-labelledby="dsh-unrestricted-update-title">
        <div className="dsh-unrestricted-header">
          <div className="dsh-unrestricted-headerTitle">
            <h4 id="dsh-unrestricted-update-title" className="dsh-unrestricted-subtitle">{t('updateTitle')}</h4>
            {update.state !== 'failed' && (
              <Tag tone={updateTagTone}>
                {update.state === 'available' && update.latestVersion !== undefined
                  ? `${t('updateAvailable')} v${update.latestVersion}`
                  : t(updateTagKey)}
              </Tag>
            )}
          </div>
          <div className="dsh-unrestricted-headerControls">
            {update.releaseUrl !== undefined && (
              <a
                className="dsh-unrestricted-link"
                href={update.releaseUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t('viewRelease')}
              </a>
            )}
            {update.state === 'available' && (
              <Button
                variant="primary"
                size="sm"
                disabled={updateBusy}
                onClick={() => { void props.performUpdate() }}
              >
                {update.latestVersion !== undefined
                  ? `${t('installUpdate')} (v${update.latestVersion})`
                  : t('installUpdate')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={updateBusy}
              onClick={() => { void props.checkUpdate(true) }}
            >
              {t('checkUpdate')}
            </Button>
          </div>
        </div>

        <dl className="dsh-unrestricted-metaGrid">
          <div className="dsh-unrestricted-metaItem">
            <dt>{t('currentVersion')}</dt>
            <dd className="dsh-unrestricted-mono">{`v${update.currentVersion}`}</dd>
          </div>
          <div className="dsh-unrestricted-metaItem">
            <dt>{t('latestVersion')}</dt>
            <dd className="dsh-unrestricted-mono">
              {update.latestVersion !== undefined ? `v${update.latestVersion}` : '—'}
            </dd>
          </div>
          <div className="dsh-unrestricted-metaItem">
            <dt>{t('installSource')}</dt>
            <dd title={update.dependencySpec}>{installSourceLabel(update.installSource, t)}</dd>
          </div>
        </dl>

        {update.state === 'updating' && (
          <p className="dsh-unrestricted-banner" data-tone="info" role="status">
            {t('updateInstalling')}
          </p>
        )}
        {(update.state === 'updated' || update.restartRequired === true) && (
          <p className="dsh-unrestricted-banner" data-tone="success" role="status">
            {t('updateInstalled')}
          </p>
        )}
        {update.state === 'failed' && (
          <p className="dsh-unrestricted-banner" data-tone="error" role="alert">
            {localizeUpdateError(update, t)}
          </p>
        )}
      </section>
    </div>
  )
}
