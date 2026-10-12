/**
 * The test runner's own config, kept beside the app rather than inside it.
 *
 * `vitest` is the runner `nuxt` itself is developed against, and it reads the same `vite` the
 * build does - so a `.ts` module, a `.json` import and a `#shared/...` specifier all resolve the
 * way they do when the site runs, and a test needs no build step of its own. Nothing here is part
 * of a deployment: `.output` is built by `nuxt build`, and this file is never read by it.
 *
 * The aliases mirror the ones Nuxt generates (see `.nuxt/tsconfig.shared.json`), so a module under
 * test resolves `#shared/...`, `#server/...` and `~~/...` exactly as the running server does.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^#shared\//, replacement: `${root}/shared/` },
      { find: '#shared', replacement: `${root}/shared` },
      { find: /^#server\//, replacement: `${root}/server/` },
      { find: '#server', replacement: `${root}/server` },
      { find: /^~~\//, replacement: `${root}/` },
      { find: '~~', replacement: root },
      { find: /^~\//, replacement: `${root}/app/` },
      { find: '~', replacement: `${root}/app` }
    ]
  },
  test: {
    // Every module under test is a server module or a shared one; none of them needs a DOM.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The modules under test keep process-wide caches (the hall of fame's exclusions, the account
    // pool's totals). Isolation gives each test file its own registry, so those never cross files -
    // and within a file the tests clear them by hand (`clearLeaderboardExclusions`, `clearAccountKeys`).
    isolate: true
  }
})
