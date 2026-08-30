/** Unrestricted mode browser half: one keyed card in the plugin-configuration tab. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the renderer provides the ctx.slots service used for registration.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the `settings.plugin.item` keyed slot declaration this card registers into.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { Context } from '@deepseek-ai/cordis'
import { createUnrestrictedController } from './controller.ts'
import { en, NS, zh, type UnrestrictedLocaleKey } from './locales.ts'
import { ensureStyles } from './styles.ts'
import { UnrestrictedCard } from './UnrestrictedCard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Unrestricted mode copy. */
    'settings.unrestricted': UnrestrictedLocaleKey
  }
}

/** Services required by the registration and the controller. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/** Contribute the unrestricted card to the plugin-configuration tab. */
export function apply(ctx: Context): void {
  ensureStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-unrestricted: dictionaries')
  const controller = createUnrestrictedController(ctx)
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'unrestricted',
    locale: NS,
    inject: () => controller.face(),
  }, UnrestrictedCard))
}
