/**
 * Fails `npm run dev` when the development port is already taken, instead of letting it drift.
 *
 * Nuxt's dev port is pinned with `--port 3100` (see `nuxt.config.ts`), and the CLI argument is the
 * one answer a stray `PORT` in the environment cannot move. A port that is already *in use* is a
 * different problem: the listener then moves to the next free one, and a dev server on 3101 answers
 * an OAuth callback that Battle.net refuses - with a message about the redirect URI that says
 * nothing about the port. So the port is checked first, and a busy one stops the command with a line
 * that names the real cause: another dev server, or another application, is already on it.
 *
 * The check is a connection rather than a bind: a dev server that listens on `[::1]:3100` alone
 * (which is what Nuxt's does on Windows) is not found by trying to bind the wildcard address, but it
 * always answers a connection. `localhost` is tried as both families by Node's own happy-eyeballs.
 *
 * Not shipped: it runs only from the `dev` script, before Nuxt starts.
 */
import { connect } from 'node:net'

const PORT = Number(process.argv[2] || 3100)

function reportTaken() {
  console.error('')
  console.error(`[dev] Port ${PORT} is already in use.`)
  console.error('      Stop the other dev server (or the application on that port) and run this again.')
  console.error(`      Development is pinned to ${PORT} because the Battle.net callback is`)
  console.error(`      registered against http://localhost:${PORT}/api/auth/callback.`)
  console.error('')
  process.exit(1)
}

function reportFree() {
  process.exit(0)
}

const socket = connect({ port: PORT, host: 'localhost' })

socket.setTimeout(1500)
socket.once('connect', () => {
  socket.destroy()
  reportTaken()
})
// Nothing answered: no connection, no refusal, no reply - the port is free to take.
socket.once('timeout', () => {
  socket.destroy()
  reportFree()
})
socket.once('error', () => reportFree())

