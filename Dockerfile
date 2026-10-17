# syntax=docker/dockerfile:1

# Hero of Azeroth in one image.
#
# `builder` does exactly what a developer's machine does before a deploy -
# `npm ci` and `nuxt build` - and leaves the Nitro `node-server` output in
# `.output`. `runtime` carries that directory and nothing else: no sources, no
# dev dependencies, no `.env`.
#
# Debian ("bookworm-slim") rather than Alpine on purpose. `sharp` and
# `@resvg/resvg-js` are native libraries, and this project pins their glibc
# builds (`@img/sharp-linux-x64`, `@resvg/resvg-js-linux-x64-gnu` in
# `package.json`); the musl builds an Alpine image would need are not in the
# lockfile.
#
# Node 24 rather than the README's "Node >= 20": the site keeps its data in
# `node:sqlite` (`server/utils/db.ts`), which appears in Node 22.5 and still
# needs a flag there. 24 is what `@types/node` and the lockfile target, and what
# the project is developed on.

FROM node:24-bookworm-slim AS builder

WORKDIR /app

# The Nitro build peaks above Node's own default heap when the engine runs in a
# small VM: on an 8 GB Mac with OrbStack's 4 GB limit the build aborts with
# SIGABRT around 2 GB. This is a ceiling the build may use, not memory it
# reserves, and it lives in the builder stage only - the runtime stage sets its
# own, much smaller, heap through `docker-compose.yml`.
ENV NODE_OPTIONS=--max-old-space-size=3072

# Dependencies first, so editing a page does not re-run `npm ci`. Scripts are
# skipped for that install alone: the project's own `postinstall` is `nuxt
# prepare`, which needs the sources copied in the next step, and neither sharp
# nor resvg-js has an install script to lose (both ship their binaries as
# optional dependencies).
#
# `--force` is what makes the same Dockerfile work on an Apple Silicon Mac.
# Three devDependencies are pinned to the glibc x64 builds on purpose - a build
# made on Windows has to carry Linux binaries for the FTP host - and npm refuses
# to install a package whose `cpu` says `x64` on an arm64 machine (EBADPLATFORM).
# The arm64 counterparts are not lost by forcing it: `sharp` and `@resvg/resvg-js`
# pull the binaries for *their* platform through their own optional dependencies,
# and those are what a container built on the Mac resolves and runs.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund --force

# The build itself: `.output` is the same artifact `npm run deploy` uploads.
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime

# `HOST` is what makes the server answer outside the container: Nitro's
# node-server entry reads `NITRO_HOST`, then `HOST` (`.output/server/index.mjs`).
# `PORT` is the number `server/plugins/port.ts` falls back to anyway - naming it
# here keeps the health check and the mapping in `docker-compose.yml` reading
# the same figure.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3100 \
    NUXT_DATA_DIR=/data

WORKDIR /app

COPY --from=builder --chown=node:node /app/.output ./.output

# The one directory a restart must not lose (`server/utils/appPaths`): the
# SQLite database, the character index the sitemap is built from and the hall of
# fame's table. It is created here, owned by the unprivileged `node` user,
# because an empty named volume inherits the ownership of the directory it is
# mounted over.
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 3100

# `/api/settings` is the cheapest endpoint that proves the Nitro app is up: it
# reads the settings store and touches neither Blizzard nor the card renderer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3100) + '/api/settings').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
