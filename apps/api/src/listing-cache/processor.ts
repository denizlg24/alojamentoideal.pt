import type {
	AccommodationListingNormalizedContent,
	AccommodationListingProcessedContent,
} from "@workspace/db";
import { OpenAI } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { AMENITY_ICON_NAMES, AMENITY_ICON_SET } from "./amenity-icons.js";
import {
	amenityInputs,
	guideToText,
	type ListingCacheProjection,
} from "./normalizer.js";

const DEFAULT_OPENAI_LISTING_MODEL = "gpt-5.5";

const localizedTextSchema = z.object({
	en: z.string(),
	es: z.string(),
	pt: z.string(),
});

const processedContentSchema = z.object({
	amenities: z.array(
		z.object({
			icon: z.object({
				name: z.enum(AMENITY_ICON_NAMES),
				set: z.literal(AMENITY_ICON_SET),
			}),
			id: z.string().nullable(),
			labels: localizedTextSchema,
			sourceLabel: z.string(),
		}),
	),
	description: localizedTextSchema,
	guide: localizedTextSchema,
	title: localizedTextSchema,
});

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

	readonly #client: OpenAI;
	readonly #model: string;

	constructor(config: { apiKey: string; model: string }) {
		this.#client = new OpenAI({ apiKey: config.apiKey });
		this.#model = config.model;
	}

	async process(
		input: ListingProcessingInput,
	): Promise<ListingProcessingResult> {
		try {
			const parsed = await this.parseListing(input.normalized);
			const processedAt = new Date();

			return {
				content: {
					...parsed,
					model: this.#model,
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
	): Promise<Omit<AccommodationListingProcessedContent, "model">> {
		const response = await this.#client.responses.parse({
			input: [
				{
					content:
						"You localize short-term rental listing content. Return polished, faithful en/pt/es translations. Do not invent amenities, policies, fees, access codes, or facts. Pick one allowed Font Awesome 6 icon for each amenity.",
					role: "system",
				},
				{
					content: JSON.stringify({
						allowedIconNames: AMENITY_ICON_NAMES,
						amenities: amenityInputs(normalized),
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
				format: zodTextFormat(processedContentSchema, "listing_content"),
			},
		});

		if (!response.output_parsed) {
			throw new Error("OpenAI returned no parsed listing content");
		}

		const parsed = response.output_parsed;

		return {
			amenities: parsed.amenities.map((amenity) => ({
				icon: amenity.icon,
				id: amenity.id ?? null,
				labels: amenity.labels,
				sourceLabel: amenity.sourceLabel,
			})),
			description: parsed.description,
			guide: parsed.guide,
			title: parsed.title,
		};
	}
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return "Listing content processing failed";
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
