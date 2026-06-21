/**
 * Dumps the raw, unparsed shape of every Hostify listing endpoint we sync from,
 * so the listing cache + quote normalizers can map real fields instead of
 * guessing. Runs RAW `fetch`es (no zod) against the live API and writes:
 *
 *   .hostify-dump/<listingId>/<endpoint>.json   full raw payload per listing
 *   .hostify-dump/_report.json                  merged key/type schema per endpoint
 *
 * The merged report unions keys across all listings so a field that is present
 * on one listing but null/absent on another still shows up. Inspect `_report.json`
 * (or the printed summary) to see exactly which fields exist before touching the
 * normalizer.
 *
 * Bun auto-loads the repo-root `.env`, so run it from the repo root:
 *   bun run packages/core/scripts/hostify-shape-dump.ts
 *
 * Optional: limit the blast radius while iterating:
 *   HOSTIFY_DUMP_LIMIT=1 bun run packages/core/scripts/hostify-shape-dump.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, ".hostify-dump");

const apiKey = process.env.HOSTIFY_API_KEY;
if (!apiKey) {
	throw new Error(
		"HOSTIFY_API_KEY is required (run from repo root so .env loads)",
	);
}
const baseUrl = (
	process.env.HOSTIFY_BASE_URL ?? "https://api-rms.hostify.com/"
).replace(/\/?$/, "/");
const limit = process.env.HOSTIFY_DUMP_LIMIT
	? Number(process.env.HOSTIFY_DUMP_LIMIT)
	: Number.POSITIVE_INFINITY;

// A stay window a month out, long enough to exercise min-stay + fee math.
const priceStart = isoDateInDays(30);
const priceEnd = isoDateInDays(33);

async function getRaw(
	path: string,
	query: Record<string, string | number> = {},
): Promise<unknown> {
	const url = new URL(path.replace(/^\//, ""), baseUrl);
	for (const [key, value] of Object.entries(query)) {
		url.searchParams.set(key, String(value));
	}
	const response = await fetch(url, {
		headers: { Accept: "application/json", "x-api-key": apiKey as string },
	});
	const text = await response.text();
	if (!response.ok) {
		return { __error: `HTTP ${response.status}`, body: safeJson(text) };
	}
	return safeJson(text);
}

function safeJson(text: string): unknown {
	if (!text) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return { __unparsed: text.slice(0, 500) };
	}
}

function isoDateInDays(days: number): string {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return date.toISOString().slice(0, 10);
}

function dump(listingId: string, endpoint: string, payload: unknown): void {
	const dir = join(outDir, listingId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, `${endpoint}.json`),
		JSON.stringify(payload, null, 2),
	);
}

/** A compact, mergeable description of a value's shape. */
type Shape =
	| { type: "null" }
	| { type: "scalar"; scalar: string; sample: unknown }
	| { type: "array"; items: Shape }
	| { type: "object"; keys: Record<string, Shape> };

function describe(value: unknown): Shape {
	if (value === null || value === undefined) return { type: "null" };
	if (Array.isArray(value)) {
		return {
			type: "array",
			items: value.reduce<Shape>(
				(acc, item) => mergeShape(acc, describe(item)),
				{ type: "null" },
			),
		};
	}
	if (typeof value === "object") {
		const keys: Record<string, Shape> = {};
		for (const [key, nested] of Object.entries(
			value as Record<string, unknown>,
		)) {
			keys[key] = describe(nested);
		}
		return { type: "object", keys };
	}
	return { type: "scalar", scalar: typeof value, sample: value };
}

function mergeShape(a: Shape, b: Shape): Shape {
	if (a.type === "null") return b;
	if (b.type === "null") return a;
	if (a.type === "object" && b.type === "object") {
		const keys: Record<string, Shape> = { ...a.keys };
		for (const [key, shape] of Object.entries(b.keys)) {
			keys[key] = key in keys ? mergeShape(keys[key], shape) : shape;
		}
		return { type: "object", keys };
	}
	if (a.type === "array" && b.type === "array") {
		return { type: "array", items: mergeShape(a.items, b.items) };
	}
	if (a.type === "scalar" && b.type === "scalar") {
		return a.scalar === b.scalar
			? a
			: { type: "scalar", scalar: `${a.scalar}|${b.scalar}`, sample: a.sample };
	}
	return a; // conflicting container vs scalar: keep the richer first-seen shape
}

const endpoints = (
	id: string,
): {
	name: string;
	path: string;
	query?: Record<string, string | number>;
}[] => [
	{
		name: "detail",
		path: `/listings/${id}`,
		query: { guest_guide: 1, include_related_objects: 1 },
	},
	{ name: "translations", path: `/listings/translations/${id}` },
	{ name: "photos", path: `/listings/photos/${id}` },
	{ name: "fees", path: `/listings/listing_fees/${id}` },
	{ name: "status", path: `/listings/listing_status/${id}` },
	{ name: "guest_guide", path: `/listings/guest_guide/${id}` },
	{ name: "booking_restriction", path: `/listings/booking_restriction/${id}` },
	{
		name: "price",
		path: "/listings/price",
		query: {
			end_date: priceEnd,
			guests: 2,
			include_fees: 1,
			listing_id: id,
			start_date: priceStart,
		},
	},
];

async function main(): Promise<void> {
	mkdirSync(outDir, { recursive: true });

	const listingIds: string[] = [];
	const report: Record<string, Shape> = {};
	const record = (endpoint: string, payload: unknown) => {
		report[endpoint] =
			endpoint in report
				? mergeShape(report[endpoint], describe(payload))
				: describe(payload);
	};

	// 1. List endpoint (raw), paginated, to collect every listing id.
	for (let page = 1; page <= 50; page += 1) {
		const list = await getRaw("/listings", {
			include_related_objects: 1,
			page,
			per_page: 100,
		});
		dump("_list", `page-${page}`, list);
		record("list", list);
		const rows = (list as { listings?: unknown }).listings;
		if (!Array.isArray(rows) || rows.length === 0) break;
		for (const row of rows) {
			const id = (row as { id?: unknown }).id;
			if (id != null) listingIds.push(String(id));
		}
		if (rows.length < 100) break;
	}

	const targets = listingIds.slice(0, limit);
	console.log(
		`Found ${listingIds.length} listing(s); dumping ${targets.length}.`,
	);

	// 2. Per-listing detail + sibling endpoints.
	for (const id of targets) {
		for (const endpoint of endpoints(id)) {
			const payload = await getRaw(endpoint.path, endpoint.query);
			dump(id, endpoint.name, payload);
			record(endpoint.name, payload);
		}
		console.log(`  dumped ${id}`);
	}

	writeFileSync(join(outDir, "_report.json"), JSON.stringify(report, null, 2));
	console.log(`\nWrote raw dumps + _report.json to ${outDir}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
