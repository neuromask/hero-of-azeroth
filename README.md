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

## Deploying

`npm run deploy` builds the project, pushes the sources to GitHub and uploads the
build to the FTP target, so the machine that serves the site needs no toolchain:

```bash
npm run deploy
```

1. `nuxt build` writes `.output`, the Nitro `node-server` preset.
2. The sources are committed and pushed to the current branch, `main`. GitHub
   holds the project only: `.output` is ignored by git and is never committed.
3. The contents of `.output` are uploaded over FTP to `FTP_PATH`, together with a
   `deploy.json` that records which source commit they were built from.

The build output of a Nuxt server app cannot be served by GitHub Pages: the pages
are server-rendered, and `/api/card`, `/api/character` and `/api/realms` are real
endpoints that call the Blizzard API with your client secret. A Node process has
to run the build, which is why the build goes to FTP instead of the repository.

### FTP settings

The upload reads these from the environment, falling back to `.env` (gitignored):

```bash
FTP_SERVER=www.example.com
FTP_USERNAME=...
FTP_PASSWORD=...
FTP_PATH=/data02/virt32423/domeenid/www.example.com/heroofazeroth/
# FTP_PORT=21        # optional, 21 by default
FTP_SECURE=explicit  # FTPS on port 21 (false, explicit or implicit)
FTP_INSECURE=true    # waive the certificate check when the host's certificate
                     # is issued for another name (shared hosting, usually)
```

`FTP_PATH` is the directory the server runs from, and it receives the *contents*
of `.output`: `server/`, `public/` and `nitro.json` land directly inside it. The
transfers are plain `curl` calls (Windows 10+ ships curl, and it speaks FTP and
FTPS); the password is passed to curl through a throwaway netrc file, so it never
appears on a command line or in the process list.

### Running what was uploaded

The uploaded directory is the application. No `npm install` and no build tools are
needed there, because `.output` carries its own `node_modules`, including both the
linux-x64 and the win32-x64 resvg binaries:

```bash
cd /data02/virt32423/domeenid/www.example.com/heroofazeroth

NUXT_BLIZZARD_CLIENT_ID=... \
NUXT_BLIZZARD_CLIENT_SECRET=... \
NUXT_WARBAND_CHARACTERS=eu/gordunni/нейромаск \
node server/index.mjs
```

The server listens on `PORT` (3000 by default); set `HOST` to choose the address it
binds. The variables are read per request (`useRuntimeConfig()`), so changing them
needs a restart, not a rebuild — and shipping a new version is another
`npm run deploy`.

### Options

```bash
npm run deploy                     # build, GitHub, FTP
npm run deploy -- --dry-run        # report what would happen, change nothing
npm run deploy -- --no-build       # upload the `.output` that already exists
npm run deploy -- --no-github      # sources stay local
npm run deploy -- --no-ftp         # sources only
npm run deploy -- --prune          # also delete remote files this build no longer has
npm run deploy -- --verify         # read every directory back and report missing files
npm run deploy -- -m "Fix the card"
```

`npm run deploy:ftp` uploads without building and without touching GitHub;
`npm run deploy:github` pushes the sources only.

`--verify` reads the upload back: every file has to be present, at the size it was
built with (one request per file, so it is the slow part of a deploy). Transfers
are retried a few times as well, because FTP hosts throttle a burst of uploads and
answer 451 for a while.

`--prune` never deletes directories, and only deletes files
inside `public/` and `server/chunks/` — the content-hashed bundles that change on
every build — so a mistyped `FTP_PATH` cannot wipe anything else.
