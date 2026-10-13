/**
 * The unrestricted settings card: one persisted toggle, the per-preset fusion
 * state reported by the host half, and the deploy preview for the preset the
 * user is inspecting. All data arrives through the props shares; the only
 * component-local state is which preview is open.
 */
import { useEffect, useState } from 'react'
import { MODULE_GROUPS, type ModuleId, type ModuleGroup } from '../module-config.js'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: 本体插件管理页的配置槽位。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { UnrestrictedCardInjected, UnrestrictedModeState, UnrestrictedViewSnapshot } from './controller.ts'
import type { UnrestrictedLocaleKey } from './locales.ts'

/** Full component props assembled by the Settings slot renderer. */
export type UnrestrictedCardProps =
  PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'settings.unrestricted'>
  & InjectFace<UnrestrictedCardInjected>

/** Mode rows in display order, with their locale label keys. */
const MODE_ROWS: ReadonlyArray<{
  id: string
  labelKey: UnrestrictedLocaleKey
  presetKey: UnrestrictedLocaleKey
}> = [
  { id: 'standard', labelKey: 'modeStandard', presetKey: 'presetStandard' },
  { id: 'ptc', labelKey: 'modePtc', presetKey: 'presetPtc' },
  { id: 'cordis', labelKey: 'modeCordis', presetKey: 'presetCordis' },
  { id: 'minimal', labelKey: 'modeMinimal', presetKey: 'presetMinimal' },
]

const MODULE_ROWS: ReadonlyArray<{ id: ModuleId; labelKey: UnrestrictedLocaleKey; descriptionKey: UnrestrictedLocaleKey; recommendationKey: UnrestrictedLocaleKey }> = [
  { id: 'delivery', labelKey: 'moduleDelivery', descriptionKey: 'descriptionDelivery', recommendationKey: 'recommendationDelivery' },
  { id: 'targets', labelKey: 'moduleTargets', descriptionKey: 'descriptionTargets', recommendationKey: 'recommendationTargets' },
  { id: 'reverseEngineering', labelKey: 'moduleReverse', descriptionKey: 'descriptionReverse', recommendationKey: 'recommendationReverse' },
  { id: 'networkSecurity', labelKey: 'moduleNetwork', descriptionKey: 'descriptionNetwork', recommendationKey: 'recommendationNetwork' },
  { id: 'fiction', labelKey: 'moduleFiction', descriptionKey: 'descriptionFiction', recommendationKey: 'recommendationFiction' },
  { id: 'technicalGuides', labelKey: 'moduleGuides', descriptionKey: 'descriptionGuides', recommendationKey: 'recommendationGuides' },
  { id: 'resources', labelKey: 'moduleResources', descriptionKey: 'descriptionResources', recommendationKey: 'recommendationResources' },
  { id: 'language', labelKey: 'moduleLanguage', descriptionKey: 'descriptionLanguage', recommendationKey: 'recommendationLanguage' },
  { id: 'environment', labelKey: 'moduleEnvironment', descriptionKey: 'descriptionEnvironment', recommendationKey: 'recommendationEnvironment' },
  { id: 'runtimeCoordination', labelKey: 'moduleRuntime', descriptionKey: 'descriptionRuntime', recommendationKey: 'recommendationRuntime' },
]

const GROUP_ROWS: ReadonlyArray<{ id: ModuleGroup; labelKey: UnrestrictedLocaleKey }> = [
  { id: 'general', labelKey: 'groupGeneral' },
  { id: 'specialized', labelKey: 'groupSpecialized' },
  { id: 'auxiliary', labelKey: 'groupAuxiliary' },
]

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
 * Render the unrestricted card.
 * @param props - locale copy, the card snapshot, and its actions.
 * @returns the card.
 */
export function UnrestrictedCard(props: UnrestrictedCardProps) {
  const { t } = props
  const view: UnrestrictedViewSnapshot = props.useView((snapshot: UnrestrictedViewSnapshot) => snapshot)
  const status = view.status
  const [openPreview, setOpenPreview] = useState<string | null>(null)
  const activePreview = openPreview === null ? undefined : view.previews[openPreview]

  useEffect(() => {
    if (openPreview !== null && activePreview === undefined) void props.loadPreview(openPreview)
  }, [openPreview, activePreview, props.loadPreview])

  const hasFailedMode = status !== null
    && Object.values(status.modes).some(mode => mode.state === 'failed')
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
    if (view.previews[presetId]?.status === 'failed') void props.loadPreview(presetId)
  }

  return (
    <details open className="dsh-unrestricted-card">
      <summary className="dsh-unrestricted-summary">
        <span className="dsh-unrestricted-summaryText">
          <span className="dsh-unrestricted-title" role="heading" aria-level={3}>{t('title')}</span>
          <span className="dsh-unrestricted-summaryStatus" data-state={summaryState}>{t(summaryKey)}</span>
        </span>
      </summary>
      <div className="dsh-unrestricted-content">
        <p className="dsh-unrestricted-description">{t('description')}</p>
        <label className="dsh-unrestricted-toggle">
          <input
            type="checkbox"
            checked={view.enabled}
            disabled={!view.writable || view.settingsStatus !== 'ready'}
            onChange={(event) => { void props.setEnabled(event.target.checked) }}
          />
          <span>{t('toggle')}</span>
        </label>
        {view.settingsStatus === 'unavailable' && (
          <p className="dsh-unrestricted-note">{t('settingsUnavailable')}</p>
        )}
        {view.message !== undefined && (
          <p className="dsh-unrestricted-error">{t('operationFailed')}{view.message}</p>
        )}
        <h4 className="dsh-unrestricted-statusTitle">{t('modulesTitle')}</h4>
        <p className="dsh-unrestricted-note">{t('modulesNote')}</p>
        <div className="dsh-unrestricted-actions">
          <button type="button" disabled={!view.writable || view.settingsStatus !== 'ready'}
            onClick={() => { void props.enableModules('all') }}>{t('enableAll')}</button>
          <button type="button" disabled={!view.writable || view.settingsStatus !== 'ready'}
            onClick={() => { void props.enableModules('general') }}>{t('enableGeneral')}</button>
          <button type="button" disabled={!view.writable || view.settingsStatus !== 'ready'}
            onClick={() => { void props.enableModules('auxiliary') }}>{t('enableAuxiliary')}</button>
        </div>
        <p className="dsh-unrestricted-note">{t('groupEnableNote')}</p>
        {GROUP_ROWS.map(group => (
          <section key={group.id} className="dsh-unrestricted-moduleGroup">
            <h5 className="dsh-unrestricted-groupTitle">{t(group.labelKey)}</h5>
            <ul className="dsh-unrestricted-modules">
              {MODULE_ROWS.filter(row => MODULE_GROUPS[group.id].includes(row.id)).map(row => {
                const usage = status?.modules?.find(module => module.id === row.id)
                return (
                  <li key={row.id} className="dsh-unrestricted-module">
                    <div className="dsh-unrestricted-moduleHeader">
                      <label className="dsh-unrestricted-toggle">
                        <input type="checkbox" checked={view.modules[row.id]}
                          disabled={!view.writable || view.settingsStatus !== 'ready'}
                          onChange={event => { void props.setModule(row.id, event.target.checked) }} />
                        <span>{t(row.labelKey)}</span>
                      </label>
                      <span className="dsh-unrestricted-moduleSize">{usage?.characters ?? '—'} {t('characters')}</span>
                    </div>
                    <p className="dsh-unrestricted-note"><strong>{t('moduleMeaning')}</strong>{t(row.descriptionKey)}</p>
                    <p className="dsh-unrestricted-note"><strong>{t('recommendedTasks')}</strong>{t(row.recommendationKey)}</p>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
        {status?.usage !== undefined && (
          <p className="dsh-unrestricted-usage">
            {t('selectedBody')} {status.usage.characters.toLocaleString()} {t('characters')}
            {' · '}{t('savedBody')} {status.usage.savedCharacters.toLocaleString()} {t('characters')}
          </p>
        )}
        <p className="dsh-unrestricted-note">{t('usageNote')}</p>
        <h4 className="dsh-unrestricted-statusTitle">{t('statusTitle')}</h4>
        <p className="dsh-unrestricted-note">{t('previewNote')}</p>
        <ul className="dsh-unrestricted-modes">
          {MODE_ROWS.map((row) => {
            const mode = status?.modes[row.id]
            const entry = view.previews[row.id]
            const isOpen = openPreview === row.id
            return (
              <li key={row.id} className="dsh-unrestricted-mode">
                <span className="dsh-unrestricted-dot" data-state={mode?.state ?? 'off'} />
                <span className="dsh-unrestricted-modeName">{t(row.labelKey)}</span>
                <span className="dsh-unrestricted-modeState">{t(stateKey(mode))}</span>
                <code className="dsh-unrestricted-presetId">{t(row.presetKey)}</code>
                <button
                  type="button"
                  className="dsh-unrestricted-inlineAction"
                  onClick={() => { togglePreview(row.id) }}
                >
                  {t(isOpen ? 'hidePreview' : 'showPreview')}
                </button>
                {mode !== undefined && mode.issues.length > 0 && (
                  <span className="dsh-unrestricted-issues">{mode.issues.join('; ')}</span>
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
                          {t('previewSize')} {entry.preview?.lines} · {entry.preview?.bytes} B
                          {' · '}{t('actualAddition')} {entry.preview?.addedCharacters ?? '—'} {t('characters')}
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
        <p className="dsh-unrestricted-note">{t('subagentNote')}</p>
        <p className="dsh-unrestricted-note">{t('scopeNote')}</p>
        <div className="dsh-unrestricted-actions dsh-unrestricted-helpActions">
          <div className="dsh-unrestricted-helpAction">
            <button type="button" aria-describedby="dsh-unrestricted-recheck-help"
              onClick={() => { void props.recheck() }}>{t('recheck')}</button>
            <div id="dsh-unrestricted-recheck-help" className="dsh-unrestricted-actionHelp">
              <p className="dsh-unrestricted-note"><strong>{t('actionPurpose')}</strong>{t('recheckPurpose')}</p>
              <p className="dsh-unrestricted-note"><strong>{t('actionWhen')}</strong>{t('recheckWhen')}</p>
            </div>
          </div>
          <div className="dsh-unrestricted-helpAction">
            <button type="button" aria-describedby="dsh-unrestricted-refresh-help"
              onClick={() => { void props.refresh() }}>{t('refresh')}</button>
            <div id="dsh-unrestricted-refresh-help" className="dsh-unrestricted-actionHelp">
              <p className="dsh-unrestricted-note"><strong>{t('actionPurpose')}</strong>{t('refreshPurpose')}</p>
              <p className="dsh-unrestricted-note"><strong>{t('actionWhen')}</strong>{t('refreshWhen')}</p>
            </div>
          </div>
        </div>
      </div>
    </details>
  )
}
