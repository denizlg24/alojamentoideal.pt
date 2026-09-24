# syntax=docker/dockerfile:1.7

# Operations dashboard as a standalone Next.js server, built from the
# repository root. Forge supplies the deployment environment as the `forge-env`
# BuildKit secret (a sourceable `export KEY='value'` file); outside Forge pass
# any file of shell-safe assignments under the same id:
#
#   docker buildx build -f apps/admin/Dockerfile --secret id=forge-env,src=.env .
#
# Like the previous build command, the build migrates the database and seeds
# the root admin and help articles, so DATABASE_URL must be reachable from it.

ARG BUN_VERSION=1.3.3
ARG NODE_VERSION=22
ARG TURBO_VERSION=2.10.13

FROM oven/bun:${BUN_VERSION}-slim AS bun

FROM bun AS pruner
ARG TURBO_VERSION
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=alojamentoideal-bun,target=/root/.bun/install/cache,sharing=locked \
	bunx turbo@${TURBO_VERSION} prune admin --docker

# Next must build on Node: in oven/bun images `node` is Bun's shim, and the
# build crashes collecting page data under it.
FROM node:${NODE_VERSION}-bookworm-slim AS builder
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /app
ENV HUSKY=0 \
	NEXT_STANDALONE=true \
	NEXT_TELEMETRY_DISABLED=1 \
	TURBO_TELEMETRY_DISABLED=1
COPY --from=pruner /app/out/json/ ./
# Joins Forge's worker-wide install mutex so concurrent builds do not thrash
# its HDD-backed BuildKit cache.
RUN --mount=type=cache,id=forge-bun-install-lock,target=/tmp/forge-bun-install-lock,sharing=locked \
	--mount=type=cache,id=alojamentoideal-bun,target=/root/.bun/install/cache,sharing=locked \
	bun install --frozen-lockfile
COPY --from=pruner /app/out/full/ ./
RUN --mount=type=secret,id=forge-env,required=true \
	--mount=type=cache,id=alojamentoideal-admin-next,target=/app/apps/admin/.next/cache \
	set -a && . /run/secrets/forge-env && set +a \
	&& (cd packages/db && bun run db:migrate) \
	&& (cd apps/admin && bun run db:seed-root-admin && bun run db:seed-help-articles) \
	&& ./node_modules/.bin/turbo run build --filter=admin

FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV HOSTNAME=0.0.0.0 \
	NEXT_TELEMETRY_DISABLED=1 \
	NODE_ENV=production \
	PORT=3001
RUN groupadd --system --gid 1001 nodejs \
	&& useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/public ./apps/admin/public
USER nextjs
EXPOSE 3001
CMD ["node", "apps/admin/server.js"]
