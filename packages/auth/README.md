# @workspace/auth

[Better Auth](https://better-auth.com) configured for the monorepo, on top of
`@workspace/db` (Drizzle + PostgreSQL).

## Enabled features

- **Email + password** with **required email verification** (the verification
  email sender in `src/email.ts` is a stub that logs the link — replace it with
  a real provider before production).
- **Google** social sign-in (enabled only when the Google env vars are set).
- **Admin plugin** for separating admins from regular users: adds `role`,
  `banned`, `banReason`, `banExpires` to `user` and `impersonatedBy` to
  `session`, plus admin-only user management (`setRole`, `listUsers`,
  `banUser`, …). Admin endpoints require an authenticated admin session.

## Architecture

The **Next.js web app is the single auth origin**: it mounts `auth.handler` at
`/api/auth/*` and the browser talks to it through the React client
(`./client`).

## Exports

- `.` (server) — lazy `getAuth()` accessor, compatibility `auth` proxy,
  `getAuthConfig`, and `Auth` / `Session` / `AuthUser` types. The package root
  is import-light; `pg`/Better Auth runtime code loads only when auth is used.
  Never bundle into client code.
- `./client` — `authClient` (from `better-auth/react`) plus `signIn`,
  `signOut`, `signUp`, `useSession`, `getSession`, `admin`. Safe for the
  browser. The web app re-exports this from `apps/web/lib/auth-client.ts`.

## Environment

Server:

| Variable                | Required             | Notes                                                |
| ----------------------- | -------------------- | ---------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | yes in production    | ≥32 chars. Dev falls back to an insecure placeholder |
| `BETTER_AUTH_URL`       | recommended          | Auth base URL, defaults to `http://localhost:3000`   |
| `AUTH_TRUSTED_ORIGINS`  | for cross-origin web | Comma-separated list of allowed origins              |
| `DATABASE_URL`          | yes                  | See `@workspace/db`                                  |
| `GOOGLE_CLIENT_ID`      | for Google           | Enables Google provider when set with the secret     |
| `GOOGLE_CLIENT_SECRET`  | for Google           |                                                      |

Client (web):

| Variable               | Notes                                                       |
| ---------------------- | ----------------------------------------------------------- |
| `NEXT_PUBLIC_AUTH_URL` | Auth origin the browser calls, e.g. `http://localhost:3000` |

## Schema sync

The Drizzle schema in `@workspace/db` is kept in sync with this config by hand
(the Better Auth CLI generator pulls in `better-sqlite3`/node-gyp and is not
used here). If you change plugins, update `packages/db/src/schema.ts` to match
the plugin's documented fields and run `bun db:generate`.
