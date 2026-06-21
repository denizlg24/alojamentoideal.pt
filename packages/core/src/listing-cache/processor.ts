import type {
	AccommodationListingNormalizedContent,
	AccommodationListingProcessedContent,
} from "@workspace/db";
import { z } from "zod";
import { guideToText, type ListingCacheProjection } from "./normalizer";

const DEFAULT_OPENAI_LISTING_MODEL = "gpt-5.5";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const localizedTextSchema = z.object({
	en: z.string(),
	es: z.string(),
	pt: z.string(),
});

const processedContentSchema = z.object({
	description: localizedTextSchema,
	guide: localizedTextSchema,
	title: localizedTextSchema,
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

const processedContentJsonSchema = {
	additionalProperties: false,
	properties: {
		description: localizedTextJsonSchema,
		guide: localizedTextJsonSchema,
		title: localizedTextJsonSchema,
	},
	required: ["description", "guide", "title"],
	type: "object",
} as const;

export type ListingProcessingStatus = "failed" | "processed" | "skipped";

export interface ListingProcessorConfig {
	apiKey?: string;
	enabled: boolean;
	model?: string;
}

export interface ListingProcessingInput {
	fallback: AccommodationListingProcessedContent;
	normalized: AccommodationListingNormalizedContent;
	sourceHash: string;
}

export interface ListingProcessingResult {
	content: AccommodationListingProcessedContent;
	error: string | null;
	processedAt: Date | null;
	processedSourceHash: string | null;
	status: ListingProcessingStatus;
}

export interface ListingContentProcessor {
	readonly enabled: boolean;
	process(input: ListingProcessingInput): Promise<ListingProcessingResult>;
}

export function createListingContentProcessor(
	config: ListingProcessorConfig,
): ListingContentProcessor {
	if (!config.enabled || !config.apiKey) {
		return new FallbackListingContentProcessor();
	}

	return new OpenAIListingContentProcessor({
		apiKey: config.apiKey,
		model: config.model ?? DEFAULT_OPENAI_LISTING_MODEL,
	});
}

class FallbackListingContentProcessor implements ListingContentProcessor {
	readonly enabled = false;

	async process(
		input: ListingProcessingInput,
	): Promise<ListingProcessingResult> {
		return {
			content: input.fallback,
			error: null,
			processedAt: null,
			processedSourceHash: null,
			status: "skipped",
		};
	}
}

class OpenAIListingContentProcessor implements ListingContentProcessor {
	readonly enabled = true;

	readonly #apiKey: string;
	readonly #model: string;

	constructor(config: { apiKey: string; model: string }) {
		this.#apiKey = config.apiKey;
		this.#model = config.model;
	}

	async process(
		input: ListingProcessingInput,
	): Promise<ListingProcessingResult> {
		try {
			const parsed = await this.parseListing(input.normalized);
			const processedAt = new Date();

			return {
				// Amenities are resolved deterministically from the static catalog
				// (see normalizer); the model only localizes free-form text.
				content: {
					amenities: input.fallback.amenities,
					description: parsed.description,
					guide: parsed.guide,
					model: this.#model,
					title: parsed.title,
				},
				error: null,
				processedAt,
				processedSourceHash: input.sourceHash,
				status: "processed",
			};
		} catch (error) {
			return {
				content: input.fallback,
				error: normalizeError(error),
				processedAt: null,
				processedSourceHash: null,
				status: "failed",
			};
		}
	}

	private async parseListing(
		normalized: AccommodationListingNormalizedContent,
	): Promise<
		Omit<AccommodationListingProcessedContent, "amenities" | "model">
	> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000);

		try {
			const response = await fetch(OPENAI_RESPONSES_URL, {
				body: JSON.stringify({
					input: [
						{
							content:
								"You localize short-term rental listing content. Return polished, faithful en/pt/es translations. Do not invent policies, fees, access codes, or facts.",
							role: "system",
						},
						{
							content: JSON.stringify({
								description: normalized.description,
								guide: guideToText(normalized.guide),
								title: normalized.title,
								translations: normalized.translations,
							}),
							role: "user",
						},
					],
					model: this.#model,
					text: {
						format: {
							name: "listing_content",
							schema: processedContentJsonSchema,
							strict: true,
							type: "json_schema",
						},
					},
				}),
				headers: {
					Authorization: `Bearer ${this.#apiKey}`,
					"Content-Type": "application/json",
				},
				method: "POST",
				signal: controller.signal,
			});
			const payload = await readJson(response);

			if (!response.ok) {
				throw new Error(
					`OpenAI listing processing failed with status ${response.status}`,
				);
			}

			const outputText = extractOutputText(payload);
			if (!outputText) {
				throw new Error("OpenAI returned no listing content text");
			}

			const parsed = processedContentSchema.parse(JSON.parse(outputText));

			return {
				description: parsed.description,
				guide: parsed.guide,
				title: parsed.title,
			};
		} finally {
			clearTimeout(timeoutId);
		}
	}
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return "Listing content processing failed";
}

async function readJson(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

function extractOutputText(payload: unknown): string | null {
	const record = asRecord(payload);
	if (typeof record.output_text === "string") {
		return record.output_text;
	}

	const output = record.output;
	if (!Array.isArray(output)) {
		return null;
	}

	for (const item of output) {
		const content = asRecord(item).content;
		if (!Array.isArray(content)) {
			continue;
		}

		for (const block of content) {
			const text = asRecord(block).text;
			if (typeof text === "string") {
				return text;
			}
		}
	}

	return null;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

export function listingProcessingInput(
	projection: ListingCacheProjection,
): ListingProcessingInput {
	return {
		fallback: projection.processedFallback,
		normalized: projection.normalized,
		sourceHash: projection.sourceHash,
	};
}
