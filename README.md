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
account-wide mount journal and reputation tab; pets, toys and decor come back
account-wide already. Every character page reports the character the way the API
returns it, and each tile says in small print whose numbers it shows: `account-wide`
for pets, toys and decor, `per character` for mounts, reputations and achievement
points.

Reading an account's whole journal instead would need a user OAuth login
(`/profile/user/wow/collections/mounts` answers 403 to a client-credentials token),
so a public deployment shows one character at a time.

The two facts a deployment has of its own — where it is published and which tag
manager container it reports to — are configuration as well, so a staging copy or a
second host needs no code change:

```bash
NUXT_PUBLIC_SITE_URL=https://heroofazeroth.com
NUXT_PUBLIC_GTM_ID=GTM-WXMVB755
```

`NUXT_PUBLIC_SITE_URL` is what canonical links, `og:url`, the hreflang alternates,
the JSON-LD nodes and `sitemap.xml` are built on. `public/robots.txt` names the same
host literally, so the two have to be changed together. The Google Tag Manager
snippet itself (the loader in `<head>`, the `<noscript>` frame right after `<body>`)
is set up in `nuxt.config.ts` under `app.head`; the container carries the tags.

An address names its language and its region: a character page is
`/region-eu/gordunni/neromask`, a front door that stays on `/`. Only the non-default
language spells itself out, so the Russian copy of every page sits under `/ru`
(`/ru`, `/ru/region-eu/gordunni/neromask`) and the English one is the plain address.
The region is the bare `eu` / `us` of the Blizzard API spelled as `region-eu`, which
leaves room for a language in the first segment and keeps `/api/card/eu/...` and the
page that shows it telling the same story. The pages serve the Russian address as an
alias of the English one and `app/middleware/lang.global.ts` applies the language an
address names. Addresses from before the change - `/eu/gordunni/neromask`, `?lang=ru`
- are answered with a permanent redirect by `server/middleware/legacy-urls.ts`, so a
link shared earlier still lands on the right page.

The built server listens on `PORT`, else on `NITRO_PORT`, else on **3100**: Nitro's
own fallback is 3000, which the second application on this host already owns, so
`server/plugins/port.ts` supplies the number (from `runtimeConfig.port`, set in
`nuxt.config.ts`). A host that assigns a port through `PORT` or `NITRO_PORT` still
overrides it. `nuxt dev` uses the same 3100 through `devServer.port`.

## Development Server

Start the development server on `http://localhost:3100`:

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
# FTP_TLS_MAX=1.2    # highest TLS version for FTPS (1.2, because 1.3 data
                     # connections tend to be aborted by these hosts)
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
node server/index.mjs
```

The server listens on `PORT`, else on `NITRO_PORT`, and on 3100 when neither is set
(the host's other application owns Nitro's 3000 default); set `HOST` to choose the
address it binds. The variables are read per request (`useRuntimeConfig()`), so
changing them needs a restart, not a rebuild — and shipping a new version is another
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
