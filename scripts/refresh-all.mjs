/**
 * Every refresh a patch wants, in the order their outputs are read.
 *
 * A patch moves two kinds of number: the ones the site pays for once and ships with the build - the
 * collections atlas, the achievement catalogue, the reputation and total snapshots - and the ones it
 * reads live for whoever is being looked at. Only the first kind is refreshed here, and every step is
 * the same script `package.json` exposes on its own: this runs them in order, reports what each one
 * wrote, and names the headings a new patch brought that the Russian label map has not got yet.
 *
 * The character the Armoury is read with is the one the snapshot already records, so a second run needs
 * no arguments at all; `region realm name` changes it.
 *
 * Usage: npm run refresh:all [region] [realm] [name] [--only=a,b] [--no-fresh] [--dry-run]
 *
 *   --only       run just these steps: collections, armoury, meta, points, reputations
 *   --no-fresh   keep the throw-away caches of the achievement and reputation walks (a quick pass)
 *   --dry-run    print the commands and run nothing
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ATLAS = path.join(ROOT, 'server', 'utils', 'collections-data.json')
const ARMOURY = path.join(ROOT, 'server', 'utils', 'armoury-totals.json')
const LABELS = path.join(ROOT, 'shared', 'data', 'collectionsSchema.ts')

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)

/** The value of `--flag=value` or of `--flag value`, or the fallback when the flag is not given. */
function flagValue(flag, fallback = '') {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (inline) return inline.slice(flag.length + 1)
  const index = argv.indexOf(flag)
  const next = argv[index + 1]
  return index === -1 || next === undefined || next.startsWith('--') ? fallback : next
}

/**
 * The three arguments that are not flags: region, realm and name. The value of `--only` is stepped over
 * when it is written apart from its flag, so it is never read as a region.
 */
const onlyAt = argv.indexOf('--only')
const positional = argv.filter((arg, index) => !arg.startsWith('--') && index !== (onlyAt === -1 ? -1 : onlyAt + 1))

const reference = String(JSON.parse(fs.readFileSync(ARMOURY, 'utf8')).reference || 'eu/tarren-mill/wanplus').split('/')

const REGION = (positional[0] || reference[0] || 'eu').toLowerCase()
const REALM = positional[1] || reference[1]
const NAME = positional[2] || reference[2]
const FRESH = has('--no-fresh') ? [] : ['--fresh']
const WANTED = flagValue('--only')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean)

/** The steps, in order: what a patch adds to the atlas, the snapshots the tiles fall back on, then the
 *  three walks. `--only` names them by their key. */
const STEPS = [
  { key: 'collections', script: 'refresh-collections.mjs', args: [REGION], atlas: true },
  { key: 'armoury', script: 'refresh-armoury-totals.mjs', args: [REGION, REALM, NAME] },
  { key: 'meta', script: 'refresh-achievement-meta.mjs', args: [REGION, '8', ...FRESH] },
  { key: 'points', script: 'refresh-achievement-points.mjs', args: [REGION, ...FRESH] },
  { key: 'reputations', script: 'refresh-reputation-totals.mjs', args: [REGION, ...FRESH] }
].filter((step) => !WANTED.length || WANTED.includes(step.key))

/** Every heading a shelf draws - the group and the sources under it - as the atlas has it right now. */
function headings() {
  const atlas = JSON.parse(fs.readFileSync(ATLAS, 'utf8'))
  const names = new Set()
  for (const groups of Object.values(atlas.shelves)) {
    for (const group of groups) {
      names.add(group.en)
      for (const sub of group.subs) names.add(sub.en)
    }
  }
  return names
}

/** Whether the Russian label map already carries a heading, quoted or bare. */
function labelled(name) {
  const source = fs.readFileSync(LABELS, 'utf8')
  return source.includes(`'${name}':`) || new RegExp(`\\n\\s{2,4}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`).test(source)
}

const line = (text = '') => console.log(text)
const rule = '─'.repeat(64)

line()
line(`Refreshing for region ${REGION}` + (STEPS.some((step) => step.script.includes('armoury')) ? `, Armoury read with ${REALM}/${NAME}` : ''))
line(`Steps: ${STEPS.map((step) => step.key).join(', ')}${FRESH.length ? ' (fresh)' : ' (keeping the walks\' caches)'}`)
line()

let failed = 0
for (const [index, step] of STEPS.entries()) {
  const before = step.atlas ? headings() : null
  const command = [path.join('scripts', step.script), ...step.args].join(' ')
  line(rule)
  line(`[${index + 1}/${STEPS.length}] ${step.key}  →  node ${command}`)
  line(rule)

  if (has('--dry-run')) {
    line('  (dry run: nothing was run)')
    line()
    continue
  }

  const started = Date.now()
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', step.script), ...step.args], {
    cwd: ROOT,
    stdio: 'inherit'
  })
  const seconds = ((Date.now() - started) / 1000).toFixed(0)

  if (result.status !== 0) {
    failed++
    line(`  ✗ ${step.key} failed after ${seconds}s (exit ${result.status})`)
    line()
    continue
  }

  line(`  ✓ ${step.key} done in ${seconds}s`)

  if (before) {
    const now = headings()
    const added = [...now].filter((name) => !before.has(name))
    const missing = added.filter((name) => !labelled(name))
    line(
      added.length
        ? `  ${added.length} new heading(s): ${added.join(', ')}`
        : '  no new headings'
    )
    if (missing.length) {
      line(`  ⚠ not in the Russian label map yet (they read in English): ${missing.join(', ')}`)
      line(`    shared/data/collectionsSchema.ts → SIMPLEARMORY_LABELS_RU`)
    }
  }
  line()
}

line(rule)
line(failed ? `${failed} of ${STEPS.length} step(s) failed` : `${STEPS.length} of ${STEPS.length} step(s) done`)
line()
line('The snapshots are compiled into the build, so nothing is live until the site is published:')
line('  npm run deploy')
line()

process.exit(failed ? 1 : 0)
