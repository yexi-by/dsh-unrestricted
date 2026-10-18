/**
 * Browser half: owns the settings page and the composer-dock switch, both fed
 * by one controller so the two surfaces never disagree about the toggle.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the renderer provides the ctx.slots service used for registration.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the conversation composer dock slot contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Context } from '@deepseek-ai/cordis'
import { createUnrestrictedController } from './controller.ts'
import { en, NS, zh, type UnrestrictedLocaleKey } from './locales.ts'
import { ensureStyles } from './styles.ts'
import { UnrestrictedCard } from './UnrestrictedCard.tsx'
import { UnrestrictedDock } from './UnrestrictedDock.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Unrestricted mode copy. */
    'settings.unrestricted': UnrestrictedLocaleKey
  }
}

/** Services required by the registrations and the controller. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'configForms']

/** Settings nav position: after Plugins (15), before the later feature sections. */
const SECTION_ORDER = 16

/** Composer tool-row position: after the shipped mode chips, before the model seat. */
const DOCK_ORDER = 20

/**
 * Register the settings page and the composer-dock switch.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  ensureStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-unrestricted: dictionaries')
  const controller = createUnrestrictedController(ctx)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'unrestricted',
    order: SECTION_ORDER,
    label: () => ctx.locale.bind(NS)('sectionLabel'),
    locale: NS,
    inject: () => controller.face(),
  }, UnrestrictedCard))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'unrestricted-toggle',
    order: DOCK_ORDER,
    locale: NS,
    inject: () => controller.face(),
  }, UnrestrictedDock))
}
