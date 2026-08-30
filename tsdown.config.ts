/**
 * Client-bundle build for the dsh-unrestricted browser half. Mirrors the
 * artifact contract of the official UI plugin preset
 * (deepseek-harness/packages/client/tsdown.client.ts) without importing it:
 * a lazy-CJS factory handed to window.__ModuleLoader__.load, with only the
 * shell's platform modules left external and every other dependency inlined.
 * The node half (src/node.js) ships unbundled; only the browser half is built.
 */
import { defineConfig } from 'tsdown'

const ID = 'dsh-unrestricted'

/** Platform modules supplied by the current Web shell. */
const EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig({
  name: `${ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: (id: string) => EXTERNALS.includes(id),
    alwaysBundle: (id: string) => !EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
