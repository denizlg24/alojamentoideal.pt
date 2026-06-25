# @workspace/db

Drizzle ORM + PostgreSQL data layer for the monorepo. Currently holds the
Better Auth schema; future features (orders, catalog projections) add their
tables here.

## Exports

- `getDb()` — lazily created singleton Drizzle client (never opens a socket on
  import).
- `getPool()` — the underlying `pg` Pool.
- `schema` and the individual tables (`user`, `session`, `account`,
  `verification`).

## Environment

| Variable                  | Required | Default                                                       |
| ------------------------- | -------- | ------------------------------------------------------------- |
| `DATABASE_URL`            | yes\*    | `postgres://postgres:postgres@localhost:5432/alojamentoideal` |
| `DATABASE_POOL_MAX`       | no       | `10`                                                          |
| `DATABASE_BUILD_POOL_MAX` | no       | `1` during `next build`                                      |

\* The default matches the local `docker-compose` Postgres, so local dev works
without setting it. Always set it explicitly in deployed environments.

`DATABASE_BUILD_POOL_MAX` caps each build worker's Postgres pool while Next.js
prerenders cached catalog pages. Keep it low on hosted databases with small
connection limits.

## Local database

From the repo root:

```bash
bun db:up        # start the docker-compose Postgres
bun db:migrate   # apply migrations in packages/db/drizzle
bun db:studio    # open Drizzle Studio
bun db:down      # stop Postgres (data volume is preserved)
```

## Schema changes

The schema mirrors what Better Auth expects (see `@workspace/auth`). After
editing `src/schema.ts`:

```bash
bun db:generate  # create a new SQL migration from the schema diff
bun db:migrate   # apply it
```

Migrations under `drizzle/` are committed and are the source of truth; they are
excluded from Biome formatting.
