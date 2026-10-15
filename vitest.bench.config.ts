/**
 * The runner's config for the load tests, which are not part of the test suite.
 *
 * `npm test` runs `test/**\/*.test.ts`; the load tests live in `test/bench` and are named `*.bench.ts`, so the
 * suite never picks them up. They build a database of their own - two hundred thousand characters and their
 * readings - which takes far longer than every other test together, and they measure rather than assert.
 *
 * Run them with `npm run test:bench`.
 */
import { defineConfig } from 'vitest/config'
import base from './vitest.config'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    // The suite's own `include` is replaced rather than added to: `mergeConfig` concatenates arrays, and a load
    // test that ran on every `npm test` would make the suite minutes long.
    include: ['test/bench/**/*.bench.ts'],
    // Building the population and reading it a few dozen times is seconds to minutes, not milliseconds.
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 15 * 60 * 1000
  }
})
