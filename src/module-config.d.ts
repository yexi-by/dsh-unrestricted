export type ModuleId = 'delivery' | 'targets' | 'reverseEngineering' | 'networkSecurity' | 'fiction' | 'technicalGuides' | 'resources' | 'language' | 'environment' | 'runtimeCoordination'
export type ModuleSettings = Record<ModuleId, boolean>
export type ModuleGroup = 'general' | 'specialized' | 'auxiliary'
export type EnableGroup = 'all' | 'general' | 'auxiliary'
export const MODULE_IDS: readonly ModuleId[]
export const MODULE_GROUPS: Readonly<Record<ModuleGroup, readonly ModuleId[]>>
export const DEFAULT_MODULES: Readonly<ModuleSettings>
export const ALL_MODULES: Readonly<ModuleSettings>
export const NO_MODULES: Readonly<ModuleSettings>
export const LEAN_MODULES: Readonly<ModuleSettings>
export function resolveModules(config?: Partial<ModuleSettings>): ModuleSettings
