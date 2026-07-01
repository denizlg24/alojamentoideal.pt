/**
 * Backfills localized listing prose (lead description + house guide) into the
 * local catalog read model using the OpenAI LLM, and optionally pushes the
 * localized descriptions back to Hostify. It finds listings whose
 * `accommodation_listing.processed` content is missing, is the untranslated
 * `repeatLocalized` fallback (the same source text copied into all three
 * locales, marked by `processed.model === null`), or has fields in the wrong
 * language, then produces faithful en / pt-PT / es-ES text.
 *
 * The localization itself (prompt, schema, guide cleanup, OpenAI call) is the
 * shared `@workspace/core/listing-cache` localization module, the SAME one the
 * incremental sync uses, so the script and the sync never diverge.
 *
 * It never invents host-provided facts. The house guide is only translated from
 * what Hostify already provides (empty guide -> empty output; empty sections and
 * trailing headings are stripped). The description is marketing copy: when it is
 * missing it is composed from verified public attributes (location, property
 * type, room counts, capacity, amenities) only. The listing title is a proper
 * name and is kept verbatim across locales (never translated).
 *
 * Runs in DRY-RUN by default: it selects candidates, calls the LLM, prints a
 * per-listing before/after diff, and writes a JSON report. Nothing is written to
 * the database (or Hostify) until you pass `--apply`.
 *
 * Bun auto-loads the repo-root `.env`, so run it from the repo root:
 *   bun run packages/core/scripts/localize-listings.ts                 # dry run
 *   bun run packages/core/scripts/localize-listings.ts --no-llm        # selection only, free
 *   bun run packages/core/scripts/localize-listings.ts --verify-endpoint
 *   bun run packages/core/scripts/localize-listings.ts --listing 123 --limit 1
 *   bun run packages/core/scripts/localize-listings.ts --apply
 *   bun run packages/core/scripts/localize-listings.ts --apply --push-hostify
 *
 * Required env: DATABASE_URL, OPENAI_API_KEY (except for --no-llm),
 * HOSTIFY_API_KEY (only for --push-hostify --apply).
 * Optional env: OPENAI_LISTING_MODEL (default "gpt-5.5").
 *
 * Flags:
 *   --apply              Persist results to accommodation_listing (default: dry run).
 *   --push-hostify       Also push localized descriptions back to Hostify as
 *                        per-language translations (only with --apply; the guide
 *                        and title are not pushed).
 *   --limit N            Cap number of listings processed (cost control).
 *   --listing <extId>    Target a specific listing; repeatable.
 *   --force              Ignore the candidate filter; process every listing.
 *   --only-missing       Restrict to missing/fallback-only (drop wrong-language re-fixes).
 *   --no-llm             Report candidates + reasons only; make no OpenAI calls.
 *   --no-exemplars       Skip style-priming with existing well-written listings.
 *   --concurrency N      Parallel OpenAI calls (default 3).
 *   --model <id>         Override OPENAI_LISTING_MODEL.
 *   --verify-endpoint    Make one throwaway OpenAI call on a synthetic sample,
 *                        print the request + parsed response shape, and exit.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HostifyClient } from "@workspace/core/integrations/hostify";
import { createHostifyClientFromEnv } from "@workspace/core/integrations/hostify";
import {
	buildListingLocalizationBody,
	guideToText,
	LISTING_LOCALIZATION_MODEL_DEFAULT,
	type ListingLocalizationExemplar,
	type ListingLocalizationFacts,
	type ListingLocalizationRequest,
	type LocalizedListingProse,
	requestListingLocalization,
} from "@workspace/core/listing-cache";
import {
	type AccommodationListingNormalizedContent,
	type AccommodationListingProcessedContent,
	accommodationListing,
	getDb,
	getPool,
	type LocalizedText,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const here = dirname(fileURLToPath(import.meta.url));
const reportDir = join(here, ".listing-localization");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_EXEMPLARS = 3;
/** A localized field is treated as translatable prose only above this length. */
const MIN_DETECT_LENGTH = 20;

const LOCALES = ["en", "pt", "es"] as const;
type Locale = (typeof LOCALES)[number];
/** Fields the LLM localizes. The title is a proper name and is not translated. */
const LOCALIZED_FIELDS = ["description", "guide"] as const;
type LocalizedField = (typeof LOCALIZED_FIELDS)[number];
/** Fields compared/persisted, including the passthrough title. */
const FINAL_FIELDS = ["description", "guide", "title"] as const;
/** Locale key -> Hostify translation language code. */
const HOSTIFY_LANGUAGE: Record<Locale, string> = {
	en: "en",
	es: "es",
	pt: "pt",
};

interface Args {
	apply: boolean;
	concurrency: number;
	exemplars: boolean;
	force: boolean;
	limit: number;
	listings: string[];
	model: string;
	noLlm: boolean;
	onlyMissing: boolean;
	pushHostify: boolean;
	verifyEndpoint: boolean;
}

interface ListingRow {
	bathrooms: number | null;
	bedrooms: number | null;
	beds: number | null;
	city: string | null;
	country: string | null;
	externalId: string;
	id: string;
	name: string | null;
	normalized: AccommodationListingNormalizedContent;
	personCapacity: number | null;
	processed: AccommodationListingProcessedContent | null;
	processingStatus: string;
	propertyType: string | null;
	sourceHash: string;
}

interface SourceContent {
	description: string;
	guide: string;
	title: string;
}

/** The localized content persisted to `processed` (adds the passthrough title). */
interface FinalContent {
	description: LocalizedText;
	guide: LocalizedText;
	title: LocalizedText;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Args {
	const args: Args = {
		apply: false,
		concurrency: 3,
		exemplars: true,
		force: false,
		limit: Number.POSITIVE_INFINITY,
		listings: [],
		model:
			process.env.OPENAI_LISTING_MODEL ?? LISTING_LOCALIZATION_MODEL_DEFAULT,
		noLlm: false,
		onlyMissing: false,
		pushHostify: false,
		verifyEndpoint: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = () => {
			const value = argv[i + 1];
			if (value === undefined) {
				throw new Error(`Missing value for ${arg}`);
			}
			i += 1;
			return value;
		};

		switch (arg) {
			case "--apply":
				args.apply = true;
				break;
			case "--push-hostify":
				args.pushHostify = true;
				break;
			case "--force":
				args.force = true;
				break;
			case "--only-missing":
				args.onlyMissing = true;
				break;
			case "--no-llm":
				args.noLlm = true;
				break;
			case "--no-exemplars":
				args.exemplars = false;
				break;
			case "--verify-endpoint":
				args.verifyEndpoint = true;
				break;
			case "--listing":
				args.listings.push(next());
				break;
			case "--limit":
				args.limit = parsePositiveInt(arg, next());
				break;
			case "--concurrency":
				args.concurrency = parsePositiveInt(arg, next());
				break;
			case "--model":
				args.model = next();
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return args;
}

function parsePositiveInt(flag: string, raw: string): number {
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${flag} must be a positive integer (got "${raw}")`);
	}
	return value;
}

// ---------------------------------------------------------------------------
// Source content, facts, and candidate selection
// ---------------------------------------------------------------------------

function sourceOf(row: ListingRow): SourceContent {
	return {
		description: (row.normalized.description ?? "").trim(),
		guide: (guideToText(row.normalized.guide) ?? "").trim(),
		title: (row.normalized.title ?? row.name ?? "").trim(),
	};
}

function factsOf(row: ListingRow): ListingLocalizationFacts {
	return {
		amenities: extractAmenityLabels(row),
		bathrooms: row.bathrooms,
		bedrooms: row.bedrooms,
		beds: row.beds,
		capacity: row.personCapacity,
		city: row.city,
		country: row.country,
		propertyType: row.propertyType,
		title: (row.normalized.title ?? row.name ?? "").trim(),
	};
}

function extractAmenityLabels(row: ListingRow): string[] {
	const labels = new Set<string>();
	for (const amenity of row.processed?.amenities ?? []) {
		const label = amenity.labels?.en?.trim() || amenity.sourceLabel?.trim();
		if (label) labels.add(label);
	}
	if (labels.size === 0) {
		for (const amenity of row.normalized.amenities ?? []) {
			if (typeof amenity === "string") {
				if (amenity.trim()) labels.add(amenity.trim());
				continue;
			}
			if (amenity && typeof amenity === "object") {
				const name = (amenity as Record<string, unknown>).name;
				if (typeof name === "string" && name.trim()) labels.add(name.trim());
			}
		}
	}
	return [...labels].slice(0, 30);
}

/** Enough verified attributes to write a faithful blurb without inventing. */
function canComposeDescription(facts: ListingLocalizationFacts): boolean {
	return (
		facts.title.length > 0 &&
		(Boolean(facts.city) ||
			Boolean(facts.propertyType) ||
			facts.bedrooms !== null ||
			facts.capacity !== null)
	);
}

function processedField(
	processed: AccommodationListingProcessedContent | null,
	field: LocalizedField,
): LocalizedText {
	if (!processed) {
		return { en: "", es: "", pt: "" };
	}
	return processed[field];
}

/**
 * A field whose three locales are byte-identical is the `repeatLocalized`
 * fallback signature: the source text was copied, never translated.
 */
function isUntranslated(value: LocalizedText): boolean {
	const en = value.en.trim();
	const es = value.es.trim();
	const pt = value.pt.trim();
	return en.length > 0 && en === es && es === pt;
}

/**
 * Rough en/pt/es classifier for wrong-language detection. Diacritics and a few
 * marker words discriminate the three; it only needs to be good enough to flag
 * a candidate: the LLM makes the authoritative correction, so a false positive
 * only costs one extra call. Returns null when it cannot decide.
 */
function detectLanguage(text: string): Locale | null {
	const value = text.toLowerCase();
	if (value.length < MIN_DETECT_LENGTH) {
		return null;
	}

	const scores: Record<Locale, number> = { en: 0, es: 0, pt: 0 };

	// Portuguese-only orthography.
	if (/[ãõ]/.test(value)) scores.pt += 3;
	if (/ç/.test(value)) scores.pt += 2;
	if (/(ção|ões|nh|lh)/.test(value)) scores.pt += 2;
	for (const word of [
		"não",
		"você",
		"está",
		"obrigado",
		"quarto",
		"casa",
		"chegada",
		"saída",
	]) {
		if (value.includes(word)) scores.pt += 1;
	}

	// Spanish-only orthography.
	if (/[ñ¿¡]/.test(value)) scores.es += 3;
	for (const word of [
		"habitación",
		"gracias",
		"usted",
		"llegada",
		"salida",
		"baño",
		"cocina",
		"por favor",
	]) {
		if (value.includes(word)) scores.es += 1;
	}

	// English markers (also a fallback when no diacritics show up at all).
	for (const word of [
		" the ",
		" and ",
		" with ",
		" your ",
		" please ",
		" check-in",
		" bedroom",
		" bathroom",
	]) {
		if (value.includes(word)) scores.en += 1;
	}
	if (!/[áàâãéêíóôõúüñç¿¡]/.test(value)) scores.en += 1;

	const ranked = LOCALES.map(
		(locale) => [locale, scores[locale]] as const,
	).sort((a, b) => b[1] - a[1]);
	const [top, second] = ranked;
	if (!top || top[1] < 2 || (second && top[1] === second[1])) {
		return null;
	}
	return top[0];
}

interface Candidate {
	facts: ListingLocalizationFacts;
	reasons: string[];
	row: ListingRow;
	source: SourceContent;
}

function selectCandidate(row: ListingRow, args: Args): Candidate | null {
	const source = sourceOf(row);
	const facts = factsOf(row);
	const reasons: string[] = [];
	const wrongLanguageReasons: string[] = [];

	if (args.force) {
		reasons.push("forced");
		return { facts, reasons, row, source };
	}

	if (!row.processed) {
		reasons.push("no-processed-content");
	} else if (row.processed.model === null) {
		reasons.push("fallback-model-null");
	}
	if (row.processingStatus !== "processed") {
		reasons.push(`status:${row.processingStatus}`);
	}

	// Description is copy-only: fill it from verified facts even when the source
	// has no description, provided we have enough attributes to be faithful.
	const description = processedField(row.processed, "description");
	const descriptionEmpty = LOCALES.every(
		(locale) => description[locale].trim() === "",
	);
	if (
		descriptionEmpty &&
		source.description === "" &&
		canComposeDescription(facts)
	) {
		reasons.push("description-missing");
	}

	for (const field of LOCALIZED_FIELDS) {
		const localized = processedField(row.processed, field);
		const sourceText = source[field];

		if (
			sourceText.length > 0 &&
			LOCALES.some((locale) => localized[locale].trim() === "")
		) {
			reasons.push(`empty-locale:${field}`);
		}
		if (isUntranslated(localized) && sourceText.length > 0) {
			reasons.push(`untranslated:${field}`);
		}

		for (const locale of LOCALES) {
			const detected = detectLanguage(localized[locale]);
			if (detected && detected !== locale) {
				wrongLanguageReasons.push(
					`wrong-language:${field}.${locale}=${detected}`,
				);
			}
		}
	}

	if (!args.onlyMissing) {
		reasons.push(...wrongLanguageReasons);
	}

	return reasons.length > 0 ? { facts, reasons, row, source } : null;
}

// ---------------------------------------------------------------------------
// Title passthrough + finalize
// ---------------------------------------------------------------------------

function sameForAll(text: string): LocalizedText {
	return { en: text, es: text, pt: text };
}

/** The title is a proper name: keep it verbatim across locales, never translate. */
function passthroughTitle(
	source: SourceContent,
	processed: AccommodationListingProcessedContent | null,
): LocalizedText {
	const title = source.title.trim();
	if (title) {
		return sameForAll(title);
	}
	return processed?.title ?? sameForAll("");
}

function finalize(
	row: ListingRow,
	source: SourceContent,
	prose: LocalizedListingProse,
): FinalContent {
	return {
		description: prose.description,
		guide: prose.guide,
		title: passthroughTitle(source, row.processed),
	};
}

// ---------------------------------------------------------------------------
// Style exemplars
// ---------------------------------------------------------------------------

function collectExemplars(rows: ListingRow[]): ListingLocalizationExemplar[] {
	const exemplars: ListingLocalizationExemplar[] = [];
	for (const row of rows) {
		if (exemplars.length >= MAX_EXEMPLARS) break;
		const processed = row.processed;
		if (!processed || processed.model === null) continue;
		if (
			isUntranslated(processed.description) ||
			isUntranslated(processed.guide)
		) {
			continue;
		}
		const allPopulated = LOCALES.every(
			(locale) =>
				processed.description[locale].trim().length >= 60 &&
				processed.guide[locale].trim().length >= 40,
		);
		if (!allPopulated) continue;
		exemplars.push({
			description: processed.description,
			guide: processed.guide,
		});
	}
	return exemplars;
}

// ---------------------------------------------------------------------------
// Hostify write-back (descriptions only)
// ---------------------------------------------------------------------------

interface HostifyTranslationPush {
	description: string;
	language: string;
	name?: string;
}

/** Localized descriptions to push to Hostify, one per non-empty locale. */
function hostifyTranslationInputs(
	final: FinalContent,
): HostifyTranslationPush[] {
	const inputs: HostifyTranslationPush[] = [];
	for (const locale of LOCALES) {
		const description = final.description[locale].trim();
		if (!description) continue;
		const name = final.title[locale].trim();
		inputs.push({
			description,
			language: HOSTIFY_LANGUAGE[locale],
			...(name ? { name } : {}),
		});
	}
	return inputs;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

interface ProcessedListing {
	applied: boolean;
	changed: boolean;
	error: string | null;
	externalId: string;
	hostifyError: string | null;
	hostifyPushed: boolean;
	name: string | null;
	proposed: FinalContent | null;
	reasons: string[];
}

function contentChanged(
	current: AccommodationListingProcessedContent | null,
	next: FinalContent,
): boolean {
	if (!current) return true;
	return FINAL_FIELDS.some((field) =>
		LOCALES.some(
			(locale) => (current[field]?.[locale] ?? "") !== next[field][locale],
		),
	);
}

async function runPool<T, R>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;

	async function drain(): Promise<void> {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			results[index] = await worker(items[index] as T, index);
		}
	}

	const workers = Array.from(
		{ length: Math.min(concurrency, items.length) },
		() => drain(),
	);
	await Promise.all(workers);
	return results;
}

async function applyResult(
	row: ListingRow,
	final: FinalContent,
	model: string,
): Promise<void> {
	const nextProcessed: AccommodationListingProcessedContent = {
		amenities: row.processed?.amenities ?? [],
		description: final.description,
		guide: final.guide,
		model,
		title: final.title,
	};

	await getDb()
		.update(accommodationListing)
		.set({
			processed: nextProcessed,
			processedAt: new Date(),
			// Match the current source hash so the Hostify sync treats the row as
			// current and does not overwrite it until the source content changes.
			processedSourceHash: row.sourceHash,
			processingError: null,
			processingStatus: "processed",
		})
		.where(eq(accommodationListing.id, row.id));
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printDiff(
	row: ListingRow,
	source: SourceContent,
	final: FinalContent,
): void {
	console.log(`\n- ${row.externalId} ${row.name ? `(${row.name})` : ""}`);
	for (const field of LOCALIZED_FIELDS) {
		const before = processedField(row.processed, field);
		console.log(`  ${field}:`);
		console.log(
			`    source(${source[field].length}c): ${preview(source[field])}`,
		);
		for (const locale of LOCALES) {
			console.log(
				`    ${locale}: "${preview(before[locale])}"  ->  "${preview(final[field][locale])}"`,
			);
		}
	}
	console.log(`  title (kept, not translated): ${preview(final.title.en)}`);
}

function preview(value: string, max = 90): string {
	const single = value.replace(/\s+/g, " ").trim();
	return single.length > max ? `${single.slice(0, max)}…` : single;
}

// ---------------------------------------------------------------------------
// verify-endpoint
// ---------------------------------------------------------------------------

async function verifyEndpoint(apiKey: string, model: string): Promise<void> {
	const request: ListingLocalizationRequest = {
		description: "",
		facts: {
			amenities: ["Wifi", "Kitchen", "Air conditioning"],
			bathrooms: 1,
			bedrooms: 1,
			beds: 1,
			capacity: 2,
			city: "Leça da Palmeira",
			country: "Portugal",
			propertyType: "Apartment",
			title: "Seaside Studio",
		},
		guide:
			"Check-in and check-out\nCheck-in: from 15:00\nCheck-out: until 11:00",
		translations: [],
	};
	const body = buildListingLocalizationBody(model, request);
	console.log("POST", OPENAI_RESPONSES_URL);
	console.log(
		"Headers: Authorization: Bearer ***, Content-Type: application/json",
	);
	console.log("Request body:\n", JSON.stringify(body, null, 2));
	const parsed = await requestListingLocalization({ apiKey, model }, request);
	console.log("\nParsed response (validated against listing_content schema):");
	console.log(JSON.stringify(parsed, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const apiKey = process.env.OPENAI_API_KEY;

	if (args.verifyEndpoint) {
		if (!apiKey)
			throw new Error("OPENAI_API_KEY is required for --verify-endpoint");
		await verifyEndpoint(apiKey, args.model);
		return;
	}

	if (!args.noLlm && !apiKey) {
		throw new Error(
			"OPENAI_API_KEY is required (or pass --no-llm for selection only)",
		);
	}

	// The Hostify client is only needed when actually writing back.
	const hostifyClient: HostifyClient | null =
		args.pushHostify && args.apply ? createHostifyClientFromEnv() : null;

	const db = getDb();
	const baseQuery = db
		.select({
			bathrooms: accommodationListing.bathrooms,
			bedrooms: accommodationListing.bedrooms,
			beds: accommodationListing.beds,
			city: accommodationListing.city,
			country: accommodationListing.country,
			externalId: accommodationListing.externalId,
			id: accommodationListing.id,
			name: accommodationListing.name,
			normalized: accommodationListing.normalized,
			personCapacity: accommodationListing.personCapacity,
			processed: accommodationListing.processed,
			processingStatus: accommodationListing.processingStatus,
			propertyType: accommodationListing.propertyType,
			sourceHash: accommodationListing.sourceHash,
		})
		.from(accommodationListing);

	const rows = (await (args.listings.length > 0
		? baseQuery.where(inArray(accommodationListing.externalId, args.listings))
		: baseQuery)) as ListingRow[];

	console.log(`Loaded ${rows.length} listing(s).`);

	const candidates: Candidate[] = [];
	for (const row of rows) {
		const candidate = selectCandidate(row, args);
		if (candidate) candidates.push(candidate);
	}

	const targets = candidates.slice(
		0,
		Number.isFinite(args.limit) ? args.limit : candidates.length,
	);
	const hostifyMode = args.pushHostify
		? args.apply
			? " + PUSH HOSTIFY"
			: " + push-hostify (dry run: not pushed)"
		: "";
	console.log(
		`${candidates.length} candidate(s); processing ${targets.length}. ` +
			`Mode: ${args.apply ? "APPLY (writes)" : "DRY RUN (no writes)"}${args.noLlm ? " + --no-llm" : ""}${hostifyMode}.`,
	);

	if (args.noLlm) {
		for (const candidate of targets) {
			console.log(
				`  ${candidate.row.externalId}: ${candidate.reasons.join(", ")}`,
			);
		}
		writeReport(
			args,
			targets.map((candidate) => ({
				applied: false,
				changed: false,
				error: null,
				externalId: candidate.row.externalId,
				hostifyError: null,
				hostifyPushed: false,
				name: candidate.row.name,
				proposed: null,
				reasons: candidate.reasons,
			})),
		);
		return;
	}

	const exemplars = args.exemplars ? collectExemplars(rows) : [];
	console.log(`Using ${exemplars.length} style exemplar(s).`);

	const results = await runPool<Candidate, ProcessedListing>(
		targets,
		args.concurrency,
		async (candidate) => {
			const { row, source, facts, reasons } = candidate;
			try {
				const prose = await requestListingLocalization(
					{ apiKey: apiKey as string, model: args.model },
					{
						description: source.description,
						exemplars,
						facts,
						guide: source.guide,
						translations: row.normalized.translations ?? [],
					},
				);
				const final = finalize(row, source, prose);
				const changed = contentChanged(row.processed, final);

				printDiff(row, source, final);

				let applied = false;
				if (args.apply && changed) {
					await applyResult(row, final, args.model);
					applied = true;
				}

				const { hostifyError, hostifyPushed } = await maybePushHostify(
					hostifyClient,
					args,
					row,
					final,
				);

				return {
					applied,
					changed,
					error: null,
					externalId: row.externalId,
					hostifyError,
					hostifyPushed,
					name: row.name,
					proposed: final,
					reasons,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`  x ${row.externalId}: ${message}`);
				return {
					applied: false,
					changed: false,
					error: message,
					externalId: row.externalId,
					hostifyError: null,
					hostifyPushed: false,
					name: row.name,
					proposed: null,
					reasons,
				};
			}
		},
	);

	const applied = results.filter((result) => result.applied).length;
	const changed = results.filter((result) => result.changed).length;
	const failed = results.filter((result) => result.error).length;
	const pushed = results.filter((result) => result.hostifyPushed).length;
	console.log(
		`\nDone. ${changed} changed, ${applied} written, ${pushed} pushed to Hostify, ${failed} failed.` +
			(args.apply ? "" : " (dry run: nothing written; re-run with --apply)"),
	);
	writeReport(args, results);
}

async function maybePushHostify(
	client: HostifyClient | null,
	args: Args,
	row: ListingRow,
	final: FinalContent,
): Promise<{ hostifyError: string | null; hostifyPushed: boolean }> {
	if (!args.pushHostify) {
		return { hostifyError: null, hostifyPushed: false };
	}

	const translations = hostifyTranslationInputs(final);
	if (translations.length === 0) {
		return { hostifyError: null, hostifyPushed: false };
	}

	if (!args.apply || !client) {
		console.log(
			`    would push to Hostify: ${translations.map((t) => t.language).join(", ")}`,
		);
		return { hostifyError: null, hostifyPushed: false };
	}

	try {
		await client.listings.createTranslations(row.externalId, { translations });
		return { hostifyError: null, hostifyPushed: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`  x hostify ${row.externalId}: ${message}`);
		return { hostifyError: message, hostifyPushed: false };
	}
}

function writeReport(args: Args, results: ProcessedListing[]): void {
	mkdirSync(reportDir, { recursive: true });
	const path = join(
		reportDir,
		`report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
	);
	writeFileSync(
		path,
		JSON.stringify(
			{
				applied: args.apply,
				generatedAt: new Date().toISOString(),
				model: args.model,
				pushHostify: args.pushHostify,
				results,
			},
			null,
			2,
		),
	);
	console.log(`Report written to ${path}`);
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => {
		void getPool().end();
	});
