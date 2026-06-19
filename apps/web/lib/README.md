# Web lib modules

Shared web-app helpers live here, grouped by responsibility:

- `api/`: route-handler wrappers and HTTP cross-cutting concerns.
- `auth/`: web-facing auth client exports.
- `catalog/`: catalog cache helpers, tags, and catalog constants.
- `observability/`: event scheduling and error-shaping helpers.

Keep new helpers close to the domain that owns them. If a module grows beyond a
single concern, split it into a narrower file inside the same folder instead of
adding unrelated utilities to the root `lib` directory.
