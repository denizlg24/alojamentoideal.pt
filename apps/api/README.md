# API

Elysia API for Alojamento Ideal. The initial scaffold exposes:

- `GET /health`
- `GET /ready`
- `POST /cron/hostify/listings`
- a typed Hostify connector under `src/integrations/hostify`

## Commands

```sh
bun run dev
bun run typecheck
bun run test
bun run build
```

## Hostify connector

Create the connector from environment configuration:

```ts
import { createHostifyClientFromEnv } from "./src/integrations/hostify/index.js";

const hostify = createHostifyClientFromEnv();
const response = await hostify.listings.list({ page: 1, per_page: 20 });
```

Supported configuration:

| Variable | Required | Default |
|---|---:|---:|
| `HOSTIFY_API_KEY` | yes | - |
| `HOSTIFY_BASE_URL` | no | `https://api-rms.hostify.com/` |
| `HOSTIFY_TIMEOUT_MS` | no | `10000` |
| `HOSTIFY_MAX_READ_RETRIES` | no | `2` |
| `HOSTIFY_RETRY_DELAY_MS` | no | `250` |

## Hostify listing cache sync

`POST /cron/hostify/listings` polls Hostify, stores a sanitized local listing
projection in Postgres, and records a `provider_sync_run`. The route requires a
cron secret through either:

- `Authorization: Bearer <HOSTIFY_SYNC_CRON_SECRET>`
- `x-cron-secret: <HOSTIFY_SYNC_CRON_SECRET>`

Supported configuration:

| Variable | Required | Default |
|---|---:|---:|
| `HOSTIFY_SYNC_CRON_SECRET` or `CRON_SECRET` | yes | - |
| `HOSTIFY_ACCOUNT_ID` | no | `default` |
| `HOSTIFY_LISTING_SYNC_PER_PAGE` | no | `50` |
| `HOSTIFY_LISTING_SYNC_MAX_PAGES` | no | `50` |
| `HOSTIFY_LISTING_STALE_AFTER_HOURS` | no | `24` |
| `OPENAI_API_KEY` | no | - |
| `OPENAI_LISTING_MODEL` | no | `gpt-5.5` |
| `LISTING_LLM_ENABLED` | no | `true` |

The sync stores section hashes for title, description, translations, guide,
amenities, photos, fees, status, and location. If the source hash is unchanged,
the row is not rewritten. If OpenAI is configured, changed or previously
unprocessed rows are processed into `en`/`pt`/`es` display text and Font Awesome
6 icon names from `react-icons/fa6`. Without OpenAI, the sync still stores the
provider projection and deterministic fallback labels/icons.

The connector:

- exposes named methods for every documented HTTP path;
- validates successful responses at runtime with endpoint/domain schemas;
- retries only `GET` requests;
- never blindly retries Hostify mutations;
- enforces HTTPS and bounded timeouts;
- normalizes provider, network, timeout, and response-validation failures;
- keeps the API key out of normalized error messages.

Notification creation is intentionally not exposed. The downloaded Hostify
documentation describes its parameters but omits its HTTP method and URL. Do not
guess that contract; resolve it through the account-specific capability probe.

Seasonal promotion methods are typed for contract completeness but Hostify marks
the feature as beta and unavailable. Do not use them without confirmed account
support.
