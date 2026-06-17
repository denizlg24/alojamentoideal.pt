# Bokun API reference

Source material and findings backing the typed Bokun client in
`apps/api/src/integrations/bokun`.

## Files

- `rest-v1.yaml` / `rest-v2.yaml` — the OpenAPI specs downloaded from
  `https://api-docs.bokun.dev/rest-v1` and `.../rest-v2` (served as
  `/rest-v1.yaml` and `/rest-v2.yaml`).
- `rest-v1-operations.txt` / `rest-v2-operations.txt` — flat inventory of every
  operation (`METHOD path [tag] operationId`), used to scope coverage.
- `rest-v1-dto-digest.txt` / `rest-v2-dto-digest.txt` — property→type digest of
  the schemas referenced by in-scope endpoints, used to decide which response
  fields to type.

## Key contract facts

- **Same credentials for both versions.** v1 and v2 share API keys and base
  URLs and may be used interchangeably (per the v2 spec description).
- **Base URLs:** `https://api.bokun.io` (production), `https://api.bokuntest.com`
  (test). The client defaults to production; override with `BOKUN_BASE_URL`.
- **Authentication — HMAC-SHA1 request signing.** The OpenAPI specs declare auth
  as plain `access-key` / `secret-key` headers, but the client implements
  Bokun's documented HMAC scheme instead, so the secret key is never
  transmitted. Each request sends:
  - `X-Bokun-Date` — `yyyy-MM-dd HH:mm:ss` in UTC
  - `X-Bokun-AccessKey` — the access key
  - `X-Bokun-Signature` — `Base64(HMAC-SHA1(secretKey, date + accessKey + METHOD + path))`,
    where `path` includes the query string.
- **v2 data types:** monetary amounts are strings (BigDecimal), timestamps are
  UTC milliseconds. v1 conventions differ, so v1 and v2 response types are kept
  separate.
- **No documented rate-limit contract** beyond v2 returning `429`
  (`StandardErrorDto { error }`). v1 errors surface via HTTP status; failure
  bodies may carry `error` or `message`.

## Coverage

The client wraps the accommodation/booking subset (single client, `client.v1.*`
and `client.v2.*` namespaces):

- **v1:** accommodation, activity, cart, shopping-cart, checkout, booking,
  product-list.
- **v2:** booking, pricing, experience, experience-booking, availability.

Large catalog DTOs are validated with passthrough `z.looseObject` schemas that
type identity/key fields and preserve the rest, matching the Hostify connector's
approach. Tighten individual response schemas as concrete needs appear.
