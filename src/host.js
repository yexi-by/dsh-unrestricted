/**
 * Host-package resolution for a `link:`-installed bundle.
 *
 * A bundle that lives outside the profile (`link:/path/to/plugins/...`) has no
 * `node_modules` of its own, so a bare `import '@deepseek-ai/dsh-scope'` fails
 * with ERR_MODULE_NOT_FOUND and the Loader reports
 * `unrestricted (dsh-unrestricted): failed to import` — the whole plugin,
 * client half included, never activates.
 *
 * Resolve those packages through Node's `createRequire` against candidate
 * bases instead: the running DSH entry (process.argv[1]), the active profile
 * directory, every profile directory, and finally the bundle itself (which is
 * what an npm-installed copy would use). A missing package yields `undefined`
 * rather than a load failure, so a degraded deployment loses one feature
 * instead of the plugin.
 *
 * @module dsh-unrestricted/host
 */
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Successful and failed lookups alike are cached: resolution is stable per process. */
const cache = new Map()

/** Candidate `createRequire` bases, most specific first. */
function bases() {
  const list = [import.meta.url]
  try {
    const entry = process.argv[1]
    if (typeof entry === 'string' && entry.length > 0) list.push(pathToFileURL(entry).href)
  } catch {
    // no usable argv entry: the remaining bases still apply
  }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const dirs = []
  if (process.env.DSH_PROFILE_DIR) dirs.push(process.env.DSH_PROFILE_DIR)
  if (process.env.DSH_PROFILE) dirs.push(join(home, 'profiles', process.env.DSH_PROFILE))
  try {
    for (const entry of readdirSync(join(home, 'profiles'))) dirs.push(join(home, 'profiles', entry))
  } catch {
    // no profiles directory: the bases above are all we can try
  }
  for (const dir of dirs) list.push(pathToFileURL(join(dir, 'index.js')).href)
  return list
}

/**
 * Load one host package, tolerating every resolution failure.
 * @param specifier - the package name, e.g. `@deepseek-ai/schemastery`.
 * @returns the loaded module, or `undefined` when no base can resolve it.
 */
export function loadHost(specifier) {
  if (cache.has(specifier)) return cache.get(specifier)
  let value
  for (const base of bases()) {
    try {
      const require = createRequire(base)
      const loaded = require(specifier)
      if (loaded !== undefined && loaded !== null) {
        value = loaded
        break
      }
    } catch {
      // try the next base
    }
  }
  cache.set(specifier, value)
  return value
}

/**
 * Read the `enabled` flag from either a live config handle (`config.get()`,
 * what a schemastery-validated volatile config provides) or the raw object the
 * Loader passes when `Config` could not be built.
 * @param config - the plugin config handle or plain config object.
 * @returns whether unrestricted mode is on.
 */
export function readEnabled(config) {
  try {
    const value = typeof config?.get === 'function' ? config.get() : config
    return value?.enabled === true
  } catch {
    return false
  }
}
