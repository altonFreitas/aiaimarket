# ===========================================================================
# The shop, in a container.
# ===========================================================================
# Four stages: install, build, the server that runs, and the tiny sidecar
# that calls the scheduled jobs. Everything Vercel used to do for us and
# nothing it did not.
#
# WHAT GOES IN THE FINAL IMAGE: .next/standalone (a server.js plus only the
# modules it actually imports), .next/static and public/. Not the source,
# not TypeScript, not ESLint, not Tailwind, not the tests -- about 200MB
# instead of about 1.2GB.
#
# WHAT IS BAKED IN AND WHAT IS NOT, which is the one thing to understand
# before building:
#
#   NEXT_PUBLIC_* is compiled INTO the JavaScript the browser downloads.
#   It cannot be changed afterwards by setting an environment variable on
#   the container -- the string is already in the bundle. So an image is
#   specific to one shop and one domain, and a staging image is a separate
#   build. They are passed as --build-arg.
#
#   Everything else -- the service role key, SESSION_SECRET, the SMS
#   gateway, CRON_SECRET -- is read at RUN time from the container's
#   environment and must never be a build argument: a build argument ends
#   up in the image's layer history, which anybody who can pull the image
#   can read. The placeholders below exist only so the build can finish;
#   src/lib/session.ts throws at module load without SESSION_SECRET, which
#   would fail the build for a reason that has nothing to do with the code.
# ===========================================================================

FROM node:20-alpine AS base
# sharp -- which is what resizes every product photo -- ships musl binaries
# that want this. Without it next/image falls back to serving the original
# upload, which on this shop's connections is the whole optimisation gone.
RUN apk add --no-cache libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1

# --- 1. Dependencies -------------------------------------------------------
# Its own stage and copied from, so that changing a source file does not
# reinstall 400 packages: this layer is only rebuilt when the lockfile moves.
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# ci, not install: it installs exactly the lockfile and fails if
# package.json and package-lock.json disagree.
RUN npm ci

# --- 2. Build --------------------------------------------------------------
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Compiled into the browser bundle -- see the note at the top.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_STORE_NAME
ARG NEXT_PUBLIC_STORE_TZ
ARG APP_REVISION=unknown
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_STORE_NAME=$NEXT_PUBLIC_STORE_NAME \
    NEXT_PUBLIC_STORE_TZ=$NEXT_PUBLIC_STORE_TZ

# NOT SECRETS, and not arguments either. Every one of these is read again
# at run time from the container's environment; they are here so that the
# build does not stop, and their values never leave this stage.
ENV SUPABASE_SERVICE_ROLE_KEY=build-only-not-a-key \
    SESSION_SECRET=build-only-not-a-secret-build-only \
    ADMIN_EMAIL=build@example.com \
    ADMIN_PASSWORD=build-only-not-a-password

RUN npm run build

# --- 3. The server ---------------------------------------------------------
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Not root. A process that never needs to write to its own image should not
# be able to.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# public/ is NOT traced into standalone -- it is read from disk at request
# time, so it has to be copied separately or every image 404s.
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
ARG APP_REVISION=unknown
ENV APP_REVISION=$APP_REVISION
ENV PORT=3000
# 0.0.0.0, NOT the default localhost. A server bound to localhost inside a
# container is reachable only from inside that container: the port mapping
# works, the page never loads, and nothing anywhere says why.
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]

# --- 4. The scheduler ------------------------------------------------------
# Vercel ran four cron jobs (see vercel.json) and nothing outside Vercel
# does. Without them: stock reservations never expire, queued messages are
# never sent, payments are never reconciled and the dashboard's figures go
# stale -- all silently, which is the worst way for a shop to break.
#
# A sidecar rather than a thread inside the app: a job that hangs must not
# be able to take the storefront down with it, and a crashed scheduler is
# visible as a container that keeps restarting.
FROM alpine:3.20 AS cron
RUN apk add --no-cache curl tzdata
COPY docker/cron.sh /usr/local/bin/cron.sh
COPY docker/cron-entrypoint.sh /usr/local/bin/cron-entrypoint.sh
COPY docker/crontab /etc/crontabs/root
RUN chmod +x /usr/local/bin/cron.sh /usr/local/bin/cron-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/cron-entrypoint.sh"]
