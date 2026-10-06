# syntax=docker/dockerfile:1
#
# Produktions-Image der TagesTakt-Verwaltungswebsite (apps/web).
# Build aus dem Repository-Wurzelverzeichnis:
#
#   docker build \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://… \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… \
#     -t tagestakt-web .
#
# Laufzeitvariablen (nicht beim Build!): NEXT_PUBLIC_SUPABASE_URL,
# NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY und TAGESTAKT_OWNER_USER_ID.
# Siehe docs/deployment-coolify.md. Es werden keine Secrets ins Image kopiert.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# Basis: Node.js 22 + pnpm in der Version aus package.json ("packageManager") via Corepack
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Aktuelles Corepack (aktuelle Signaturschlüssel der npm-Registry), dann pnpm aktivieren.
RUN npm install --global --no-fund --no-audit corepack@0.35.0 \
    && corepack enable pnpm
WORKDIR /repo

# ---------------------------------------------------------------------------
# Abhängigkeiten: nur die Web-App und ihre Workspace-Pakete, strikt nach Lockfile
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schedule-schema/package.json packages/schedule-schema/package.json
RUN corepack install \
    && pnpm install --frozen-lockfile --filter "@tagestakt/web..."

# ---------------------------------------------------------------------------
# Build: Next.js im Standalone-Modus
# ---------------------------------------------------------------------------
FROM deps AS build
COPY packages/config packages/config
COPY packages/schedule-schema packages/schedule-schema
COPY apps/web apps/web

# Öffentliche Werte, die Next.js beim Build in den Code einsetzt (kein Secret!).
# TAGESTAKT_OWNER_USER_ID ist bewusst KEIN Build-Argument.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NODE_ENV=production
RUN if [ -z "$NEXT_PUBLIC_SUPABASE_URL" ] || [ -z "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" ]; then \
      echo "Fehler: NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY müssen als Build-Argumente gesetzt sein (siehe docs/deployment-coolify.md)." >&2; \
      exit 1; \
    fi \
    && pnpm --filter @tagestakt/web build

# ---------------------------------------------------------------------------
# Laufzeit: nur Standalone-Server + statische Dateien, ohne Quellcode und Dev-Abhängigkeiten
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# tini als PID 1: leitet SIGTERM/SIGINT weiter und räumt Zombie-Prozesse ab.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Dateien gehören root und sind für den Laufzeitbenutzer nur lesbar.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# apps/web hat derzeit keinen public/-Ordner. Falls einer hinzukommt:
# COPY --from=build /repo/apps/web/public ./apps/web/public
# Einziges beschreibbares Verzeichnis: Next.js-Cache.
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache

# Unprivilegierter Benutzer aus dem offiziellen Node-Image (UID 1000).
USER node
EXPOSE 3000

# Healthcheck ohne curl/wget – nur mit Node.js.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
# Standalone-Pfad im Monorepo: outputFileTracingRoot = Repo-Wurzel → apps/web/server.js
CMD ["node", "apps/web/server.js"]
