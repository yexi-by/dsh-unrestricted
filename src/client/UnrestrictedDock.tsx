/**
 * The composer-dock switch: one ambient button below the composer card that
 * flips the same persisted toggle the settings page owns. It subscribes to the
 * shared controller view, so both surfaces always show the same state.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the conversation composer dock slot contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UnrestrictedCardInjected } from './controller.ts'
import type { UnrestrictedLocaleKey } from './locales.ts'

/** Full component props assembled by the composer dock renderer. */
export type UnrestrictedDockProps =
  PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<'settings.unrestricted'>
  & InjectFace<UnrestrictedCardInjected>

/**
 * Render the dock switch.
 * @param props - locale copy, the shared view, and the toggle action.
 * @returns the dock button.
 */
export function UnrestrictedDock(props: UnrestrictedDockProps) {
  const { t, toggle } = props
  const view = props.useView(snapshot => snapshot)
  const ready = view.settingsStatus === 'ready' && view.writable
  const state = view.settingsStatus !== 'ready'
    ? 'pending'
    : view.enabled ? 'active' : 'off'
  const aria: UnrestrictedLocaleKey = view.settingsStatus !== 'ready'
    ? 'dockAriaLoading'
    : view.enabled ? 'dockAriaDisable' : 'dockAriaEnable'

  return (
    <div className="dsh-unrestricted-dock">
      <button
        type="button"
        className="dsh-unrestricted-dockButton"
        data-state={state}
        aria-pressed={view.enabled}
        aria-label={t(aria)}
        disabled={!ready || view.busy}
        onClick={() => { void toggle() }}
      >
        <span className="dsh-unrestricted-dockDot" data-state={state} />
        <span>{t(view.enabled ? 'dockDisable' : 'dockEnable')}</span>
      </button>
    </div>
  )
}
