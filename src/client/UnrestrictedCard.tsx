/**
 * The unrestricted settings card: one persisted toggle plus the per-preset
 * fusion state reported by the host half. All data arrives through the four
 * props shares; the component holds no state of its own.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `settings.plugin.item` keyed slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { UnrestrictedCardInjected, UnrestrictedModeState } from './controller.ts'
import type { UnrestrictedLocaleKey } from './locales.ts'

/** Full component props assembled by the Settings slot renderer. */
export type UnrestrictedCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.unrestricted'>
  & InjectFace<UnrestrictedCardInjected>

/** Mode rows in display order, with their locale label keys. */
const MODE_ROWS: ReadonlyArray<{ id: string; labelKey: UnrestrictedLocaleKey }> = [
  { id: 'standard', labelKey: 'modeStandard' },
  { id: 'code', labelKey: 'modeCode' },
  { id: 'cordis', labelKey: 'modeCordis' },
  { id: 'minimal', labelKey: 'modeMinimal' },
]

/** Locale key for one mode state. */
function stateKey(mode: UnrestrictedModeState | undefined): UnrestrictedLocaleKey {
  switch (mode?.state) {
    case 'active': return 'stateActive'
    case 'checking': return 'stateChecking'
    case 'incompatible': return 'stateIncompatible'
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
  const view = props.useView(snapshot => snapshot)
  const status = view.status
  const hasIncompatibleMode = status !== null
    && Object.values(status.modes).some(mode => mode.state === 'incompatible')
  const summaryKey: UnrestrictedLocaleKey = view.settingsStatus === 'loading'
    ? 'summaryLoading'
    : view.settingsStatus === 'unavailable'
      ? 'summaryUnavailable'
      : hasIncompatibleMode
        ? 'summaryIncompatible'
        : view.enabled ? 'summaryEnabled' : 'summaryDisabled'
  const summaryState = view.settingsStatus === 'ready'
    ? hasIncompatibleMode ? 'error' : view.enabled ? 'active' : 'off'
    : 'pending'
  return (
    <details className="dsh-unrestricted-card">
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
        <h4 className="dsh-unrestricted-statusTitle">{t('statusTitle')}</h4>
        <ul className="dsh-unrestricted-modes">
          {MODE_ROWS.map((row) => {
            const mode = status?.modes[row.id]
            return (
              <li key={row.id} className="dsh-unrestricted-mode">
                <span className="dsh-unrestricted-dot" data-state={mode?.state ?? 'off'} />
                <span className="dsh-unrestricted-modeName">{t(row.labelKey)}</span>
                <span className="dsh-unrestricted-modeState">{t(stateKey(mode))}</span>
                {mode !== undefined && mode.issues.length > 0 && (
                  <span className="dsh-unrestricted-issues">{mode.issues.join('; ')}</span>
                )}
              </li>
            )
          })}
        </ul>
        <p className="dsh-unrestricted-note">{t('subagentNote')}</p>
        {status !== null && (
          <p className="dsh-unrestricted-note">
            {t('supported')}
            {` DSH ${status.supported.version}（${status.supported.commit.slice(0, 7)}）。`}
          </p>
        )}
        <p className="dsh-unrestricted-note">{t('scopeNote')}</p>
        <div className="dsh-unrestricted-actions">
          <button type="button" onClick={() => { void props.recheck() }}>{t('recheck')}</button>
          <button type="button" onClick={() => { void props.refresh() }}>{t('refresh')}</button>
        </div>
      </div>
    </details>
  )
}
