# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setup

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Configuration

Create a `.env` with a Blizzard API client (Creator portal, client credentials):

```bash
NUXT_BLIZZARD_CLIENT_ID=...
NUXT_BLIZZARD_CLIENT_SECRET=...
```

Blizzard reports mounts and reputations per character, while the game shows an
account-wide mount journal and reputation tab. To show the account-wide numbers,
list the account's own characters as `region/realm/name`, comma separated, and
their collections are merged into every page of that account:

```bash
NUXT_WARBAND_CHARACTERS=eu/gordunni/main,eu/eversong/alt
```

Leaving it empty means every character is reported exactly as the API returns it.
The warband is a private account detail, so it is not meant to be set on a public
deployment that serves other people's characters.

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## Deploying to GitHub

`npm run deploy` builds the project and publishes it in one step, so the machine
that serves the site needs no toolchain:

```bash
npm run deploy
```

1. `nuxt build` writes `.output` (the Nitro `node-server` preset).
2. The sources are committed and pushed to the current branch, `main`.
3. `.output` is committed to the `deploy` branch as a ready-to-run bundle, next
   to a `deploy.json` that records which source commit it was built from, and a
   `README.md` that repeats the instructions below.

The build output of a Nuxt server app cannot be served by GitHub Pages: the pages
are server-rendered and `/api/card`, `/api/character` and `/api/realms` are real
endpoints that call the Blizzard API with your client secret. That is why the
bundle goes to a branch instead of a static site.

### Running the bundle

```bash
git clone --branch deploy --single-branch https://github.com/neuromask/hero-of-azeroth.git
cd hero-of-azeroth

NUXT_BLIZZARD_CLIENT_ID=... \
NUXT_BLIZZARD_CLIENT_SECRET=... \
NUXT_WARBAND_CHARACTERS=eu/gordunni/neromask \
node server/index.mjs
```

No `npm install` is needed: the bundle carries its own `node_modules`, including
both the linux-x64 and the win32-x64 resvg binaries, so the same bundle runs on a
Linux server and on Windows. Updating a running server is a fetch and a restart:

```bash
git fetch origin deploy && git reset --hard FETCH_HEAD
```

The variables are read by the running server (`useRuntimeConfig()` per request),
so a change to them needs a restart, not a rebuild. Nothing secret is committed:
`.env` stays ignored, and the bundle holds no credentials.

### Options

```bash
npm run deploy -- --dry-run          # report what would happen, push nothing
npm run deploy -- --no-build         # publish the `.output` that already exists
npm run deploy -- --no-source        # bundle only (same as npm run deploy:bundle)
npm run deploy -- --no-bundle        # sources only
npm run deploy -- --branch gh-pages  # publish the bundle somewhere else
npm run deploy -- -m "Fix the card"  # set the commit message
```

The bundle commit is written through a temporary index and a temporary work tree,
so the script never switches branches and never touches your working files, and
line endings are not converted: the server runs the exact bytes the build wrote.
Each deploy is a child of the previous bundle commit, so the remote stays
fast-forwardable; add `--force` only if the branch was rewritten somewhere else.
