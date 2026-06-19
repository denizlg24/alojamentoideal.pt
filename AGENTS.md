<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

For `apps/web/lib`, keep modularity and directory separation intact for future
agents. Add new helpers under the existing responsibility folders (`api`,
`auth`, `catalog`, `observability`) or create a clearly named domain folder; do
not flatten unrelated utilities into the root `lib` directory.
