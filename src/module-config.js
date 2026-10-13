/** Functional switches; compatibility defaults preserve every original rule. */
export const MODULE_IDS = ["delivery", "targets", "reverseEngineering", "networkSecurity", "fiction", "technicalGuides", "resources", "language", "environment", "runtimeCoordination"]
export const MODULE_GROUPS = Object.freeze({
  general: Object.freeze(['delivery', 'targets']),
  specialized: Object.freeze(['reverseEngineering', 'networkSecurity', 'fiction', 'technicalGuides', 'resources']),
  auxiliary: Object.freeze(['language', 'environment', 'runtimeCoordination']),
})
export const DEFAULT_MODULES = Object.freeze(Object.fromEntries(MODULE_IDS.map(id => [id, true])))
export const ALL_MODULES = Object.freeze(Object.fromEntries(MODULE_IDS.map(id => [id, true])))
export const NO_MODULES = Object.freeze(Object.fromEntries(MODULE_IDS.map(id => [id, false])))
export const LEAN_MODULES = Object.freeze({ ...NO_MODULES, delivery: true })

/** Resolve the compatibility defaults for fields absent from an older profile. */
export function resolveModules(config = {}) {
  return Object.fromEntries(MODULE_IDS.map(id => [id, config[id] ?? DEFAULT_MODULES[id]]))
}
