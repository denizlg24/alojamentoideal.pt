/**
 * Shared listing-content localization used by BOTH the incremental sync
 * (`processor.ts`) and the standalone backfill script
 * (`scripts/localize-listings.ts`). Keeping the prompt, schema, guide cleanup,
 * and OpenAI call in one place guarantees the sync is never weaker than the
 * script: any improvement here applies to both.
 *
 * Contract: translate/complete the lead description, public description
 * sections, and house guide into en / pt-PT / es-ES. Never invent
 * host-provided facts. The guide and sections are only translated from what the
 * source provides (empty guide sections and trailing headings are stripped).
 * The description is marketing copy and may be composed from verified public
 * attributes (`facts`) when the source is missing. The title is a proper name
 * and is intentionally NOT localized here (callers keep it verbatim).
 */
import type { LocalizedText } from "@workspace/db";
import { z } from "zod";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const LISTING_LOCALIZATION_MODEL_DEFAULT = "gpt-5.5";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

const LOCALES = ["en", "pt", "es"] as const;

export const LISTING_DESCRIPTION_SECTIONS = [
	{ key: "space", label: "The space" },
	{ key: "access", label: "Guest access" },
	{ key: "interaction", label: "During your stay" },
	{ key: "neighborhood_overview", label: "The neighborhood" },
	{ key: "transit", label: "Getting around" },
	{ key: "notes", label: "Other things to note" },
] as const;

export type ListingDescriptionSectionKey =
	(typeof LISTING_DESCRIPTION_SECTIONS)[number]["key"];

export type LocalizedDescriptionSections = Record<
	ListingDescriptionSectionKey,
	LocalizedText
>;

/** Human-facing locale intent baked into the prompt (keys stay en/es/pt). */
const LOCALE_LABELS: Record<(typeof LOCALES)[number], string> = {
	en: "English",
	es: "Spanish (Spain, es-ES)",
	pt: "European Portuguese (pt-PT, NOT Brazilian)",
};

export const LISTING_LOCALIZATION_SYSTEM_PROMPT = [
	"You localize content for Alojamento Ideal, a single operator that owns and",
	"manages its own small collection of cozy, modern, fully-equipped apartments",
	"along Portugal's North Coast (Porto, Póvoa de Varzim, Leça da Palmeira,",
	"Canidelo). Positioning: stays that feel like home: comfort, modern design,",
	"local charm, direct guest-focused hospitality.",
	"",
	"You return three fields, each localized into three locales:",
	"  en = English, pt = European Portuguese (pt-PT), es = Spanish (Spain).",
	"",
	"description (marketing copy):",
	"- If `source.description` has content, translate and lightly polish it into",
	"  each locale, preserving its meaning.",
	"- If it is missing or very thin, COMPOSE a short, inviting description",
	"  (2 to 4 sentences) in each locale using ONLY the attributes in `facts`",
	"  (location, property type, bedrooms/beds/bathrooms, capacity, amenities).",
	"  This is the only field you may write from scratch, and only from `facts`.",
	"",
	"descriptionSections (listing detail sections):",
	"- Translate ONLY the section body text present in `source.descriptionSections`.",
	"- Preserve meaning and practical details. Do not add facts.",
	"- For a section with empty source text, return an empty string in all three",
	"  locales.",
	"",
	"guide (practical guest information):",
	"- ONLY translate what is present in `source.guide`. It depends on",
	"  host-provided specifics, so NEVER invent or add sections, rules,",
	"  directions, codes, times, or fees. If `source.guide` is empty, return an",
	"  empty string in all three locales.",
	"- Preserve the section structure and line breaks. Never output a section",
	"  heading with no body: drop empty sections and any trailing heading.",
	"",
	"Global rules:",
	"- NEVER invent facts, policies, fees, access codes, room counts, addresses,",
	"  or amenities not present in `source` or `facts`.",
	"- pt MUST be European Portuguese, not Brazilian.",
	"- Do NOT use host/marketplace language (no 'trusted hosts', 'book directly',",
	"  'no middlemen', 'list your place'); every apartment is the company's own.",
	"- Avoid em dashes.",
].join("\n");

/** Verified, public catalog attributes usable to compose marketing copy. */
export interface ListingLocalizationFacts {
	amenities: string[];
	bathrooms: number | null;
	bedrooms: number | null;
	beds: number | null;
	capacity: number | null;
	city: string | null;
	country: string | null;
	propertyType: string | null;
	title: string;
}

/** Already-localized listings used to prime the house voice (few-shot). */
export interface ListingLocalizationExemplar {
	description: LocalizedText;
	descriptionSections?: Partial<LocalizedDescriptionSections>;
	guide: LocalizedText;
}

export interface ListingLocalizationRequest {
	/** Source lead description (may be empty). */
	description: string;
	/** Source public detail-section bodies keyed by Hostify description field. */
	descriptionSections?: Partial<Record<ListingDescriptionSectionKey, string>>;
	exemplars?: ListingLocalizationExemplar[];
	facts: ListingLocalizationFacts;
	/** Source house guide, already flattened to text (may be empty). */
	guide: string;
	/** Hostify's own translations, when present. */
	translations: unknown[];
}

/** The localized prose the model returns. The title is not localized here. */
export interface LocalizedListingProse {
	description: LocalizedText;
	descriptionSections: LocalizedDescriptionSections;
	guide: LocalizedText;
}

export interface ListingLocalizationClientConfig {
	apiKey: string;
	maxAttempts?: number;
	model: string;
	timeoutMs?: number;
}

const localizedTextSchema = z.object({
	en: z.string(),
	es: z.string(),
	pt: z.string(),
});

const listingProseSchema = z.object({
	description: localizedTextSchema,
	descriptionSections: z.object({
		access: localizedTextSchema,
		interaction: localizedTextSchema,
		neighborhood_overview: localizedTextSchema,
		notes: localizedTextSchema,
		space: localizedTextSchema,
		transit: localizedTextSchema,
	}),
	guide: localizedTextSchema,
});

const localizedTextJsonSchema = {
	additionalProperties: false,
	properties: {
		en: { type: "string" },
		es: { type: "string" },
		pt: { type: "string" },
	},
	required: ["en", "es", "pt"],
	type: "object",
} as const;

const listingProseJsonSchema = {
	additionalProperties: false,
	properties: {
		description: localizedTextJsonSchema,
		descriptionSections: {
			additionalProperties: false,
			properties: {
				access: localizedTextJsonSchema,
				interaction: localizedTextJsonSchema,
				neighborhood_overview: localizedTextJsonSchema,
				notes: localizedTextJsonSchema,
				space: localizedTextJsonSchema,
				transit: localizedTextJsonSchema,
			},
			required: [
				"access",
				"interaction",
				"neighborhood_overview",
				"notes",
				"space",
				"transit",
			],
			type: "object",
		},
		guide: localizedTextJsonSchema,
	},
	required: ["description", "descriptionSections", "guide"],
	type: "object",
} as const;

export function buildListingLocalizationBody(
	model: string,
	request: ListingLocalizationRequest,
): Record<string, unknown> {
	const userPayload = {
		locales: LOCALE_LABELS,
		// Verified public attributes; the only basis for composing a missing
		// description.
		facts: request.facts,
		source: {
			description: request.description,
			descriptionSections: normalizeDescriptionSections(
				request.descriptionSections,
			),
			guide: request.guide,
		},
		// Hostify's own translations, when present, are the most faithful basis.
		hostifyTranslations: request.translations,
		// Learn the house voice from real, already-localized listings.
		styleExamples: request.exemplars ?? [],
	};

	return {
		input: [
			{ content: LISTING_LOCALIZATION_SYSTEM_PROMPT, role: "system" },
			{ content: JSON.stringify(userPayload), role: "user" },
		],
		model,
		text: {
			format: {
				name: "listing_content",
				schema: listingProseJsonSchema,
				strict: true,
				type: "json_schema",
			},
		},
	};
}

/**
 * Drops empty guide sections: a block that is only a heading (no body line),
 * such as a trailing "Good to know", is removed, along with trailing
 * whitespace. Falls back to the trimmed input if every block is a single line
 * (an unstructured one-paragraph guide), so real content is never nuked.
 */
export function cleanGuide(text: string): string {
	const blocks = text
		.split(/\n{2,}/)
		.map((block) => block.replace(/[ \t]+$/gm, "").trim())
		.filter((block) => block.length > 0)
		.filter((block) => {
			const lines = block
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			return lines.length > 1;
		});
	const cleaned = blocks.join("\n\n");
	return cleaned.length > 0 ? cleaned : text.trim();
}

export function cleanGuideLocalized(guide: LocalizedText): LocalizedText {
	return {
		en: cleanGuide(guide.en),
		es: cleanGuide(guide.es),
		pt: cleanGuide(guide.pt),
	};
}

/**
 * Calls the OpenAI Responses API, validates the structured output, and returns
 * localized prose with the guide already cleaned. Retries transient failures.
 */
export async function requestListingLocalization(
	config: ListingLocalizationClientConfig,
	request: ListingLocalizationRequest,
): Promise<LocalizedListingProse> {
	const body = buildListingLocalizationBody(config.model, request);
	const maxAttempts = config.maxAttempts ?? MAX_ATTEMPTS;
	const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(OPENAI_RESPONSES_URL, {
				body: JSON.stringify(body),
				headers: {
					Authorization: `Bearer ${config.apiKey}`,
					"Content-Type": "application/json",
				},
				method: "POST",
				signal: controller.signal,
			});
			const payload = await readJson(response);

			if (!response.ok) {
				if (isRetryableStatus(response.status) && attempt < maxAttempts) {
					lastError = new Error(`OpenAI HTTP ${response.status}`);
					await backoff(attempt);
					continue;
				}
				throw new Error(
					`OpenAI request failed with status ${response.status}: ${JSON.stringify(payload)?.slice(0, 300)}`,
				);
			}

			const outputText = extractOutputText(payload);
			if (!outputText) {
				throw new Error("OpenAI returned no listing content text");
			}
			const parsed = listingProseSchema.parse(JSON.parse(outputText));
			return {
				description: parsed.description,
				descriptionSections: parsed.descriptionSections,
				guide: cleanGuideLocalized(parsed.guide),
			};
		} catch (error) {
			lastError = error;
			const aborted = error instanceof Error && error.name === "AbortError";
			if (aborted && attempt < maxAttempts) {
				await backoff(attempt);
				continue;
			}
			if (attempt >= maxAttempts) break;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error("OpenAI request failed");
}

export function emptyLocalizedDescriptionSections(): LocalizedDescriptionSections {
	return Object.fromEntries(
		LISTING_DESCRIPTION_SECTIONS.map(({ key }) => [
			key,
			{ en: "", es: "", pt: "" },
		]),
	) as LocalizedDescriptionSections;
}

function normalizeDescriptionSections(
	sections: Partial<Record<ListingDescriptionSectionKey, string>> | undefined,
): Record<ListingDescriptionSectionKey, string> {
	return Object.fromEntries(
		LISTING_DESCRIPTION_SECTIONS.map(({ key }) => [
			key,
			sections?.[key]?.trim() ?? "",
		]),
	) as Record<ListingDescriptionSectionKey, string>;
}

function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

function backoff(attempt: number): Promise<void> {
	const base = 500 * 2 ** (attempt - 1);
	const jitter = Math.floor(Math.random() * 250);
	return sleep(base + jitter);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return { __unparsed: text.slice(0, 500) };
	}
}

function extractOutputText(payload: unknown): string | null {
	const record = asRecord(payload);
	if (typeof record.output_text === "string") {
		return record.output_text;
	}
	const output = record.output;
	if (!Array.isArray(output)) return null;
	for (const item of output) {
		const content = asRecord(item).content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			const text = asRecord(block).text;
			if (typeof text === "string") return text;
		}
	}
	return null;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}
