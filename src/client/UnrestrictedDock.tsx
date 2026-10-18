/**
 * The composer tool-row switch: one compact chip inside the resident composer
 * card, next to the shipped permission and plan controls. It flips the same
 * persisted toggle the settings page owns, and subscribes to the shared
 * controller view so both surfaces always show the same state.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the conversation composer slot contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UnrestrictedCardInjected } from './controller.ts'
import type { UnrestrictedLocaleKey } from './locales.ts'

/** Full component props assembled by the composer tool-row renderer. */
export type UnrestrictedDockProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'settings.unrestricted'>
  & InjectFace<UnrestrictedCardInjected>

/**
 * Render the tool-row switch.
 * @param props - locale copy, the shared view, and the toggle action.
 * @returns the switch chip.
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
    <button
      type="button"
      className="dsh-unrestricted-chip"
      data-state={state}
      aria-pressed={view.enabled}
      aria-label={t(aria)}
      disabled={!ready || view.busy}
      onClick={() => { void toggle() }}
    >
      <span className="dsh-unrestricted-chipDot" data-state={state} />
      <span>{t(view.enabled ? 'dockDisable' : 'dockEnable')}</span>
    </button>
  )
}
