<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

For `apps/web/lib`, keep modularity and directory separation intact for future
agents. Add new helpers under the existing responsibility folders (`api`,
`auth`, `catalog`, `observability`, `site`) or create a clearly named domain
folder; do not flatten unrelated utilities into the root `lib` directory.

# The business — read before writing user-facing copy or features

Alojamento Ideal is **not** a marketplace or an OTA. It is a single operator
that owns and manages its own small collection of cozy, modern, fully-equipped
apartments along Portugal's North Coast — Porto, Póvoa de Varzim, Leça da
Palmeira and Canidelo. It also sells local activities/tours. The positioning is
"stays that feel like home": comfort, modern design and local charm, with
direct, guest-focused hospitality.

Consequences for copy and modelling:

- Do **not** write host/marketplace language ("trusted hosts", "book directly
  with the people who care for them", "no middlemen", "list your place"). There
  are no third-party hosts; every listing is the company's own.
- Public IA / labels (mirrored from the legacy app): **Homes** (`/homes`, the
  apartments), **Activities** (`/activities`, tours), **About Us**, **FAQ**,
  **Help**, and an **I'm a property owner** CTA (`/owner`, an owner-acquisition
  funnel, not user listings).
- Locations to reference for SEO/copy: Porto, Póvoa de Varzim, Leça da Palmeira,
  Canidelo (Northern Portugal / North Coast).
- Production domain is `alojamentoideal.pt`; supported locales are en/pt/es
  (current `apps/web` rewrite is English-only for now).
- Copy style: avoid em dashes.
- The legacy app lives at `E:\Ocean Informatix\AlojamentoIdeal.pt\alojamentoideal`
  and is the behavioral/visual baseline; `docs/data-architecture.md` maps legacy
  modules to the rewrite.
