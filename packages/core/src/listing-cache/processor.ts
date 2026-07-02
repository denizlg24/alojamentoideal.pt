import type {
	AccommodationListingNormalizedContent,
	AccommodationListingProcessedContent,
} from "@workspace/db";
import {
	LISTING_LOCALIZATION_MODEL_DEFAULT,
	type ListingLocalizationFacts,
	requestListingLocalization,
} from "./localization";
import { guideToText, type ListingCacheProjection } from "./normalizer";

export type ListingProcessingStatus = "failed" | "processed" | "skipped";

export interface ListingProcessorConfig {
	apiKey?: string;
	enabled: boolean;
	model?: string;
}

export interface ListingProcessingInput {
	/** Verified public attributes used to compose a missing description. */
	facts: ListingLocalizationFacts;
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
		model: config.model ?? LISTING_LOCALIZATION_MODEL_DEFAULT,
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
			const prose = await requestListingLocalization(
				{ apiKey: this.#apiKey, model: this.#model },
				{
					description: input.normalized.description ?? "",
					descriptionSections: input.normalized.descriptionSections ?? {},
					facts: input.facts,
					guide: guideToText(input.normalized.guide) ?? "",
					translations: input.normalized.translations,
				},
			);
			const processedAt = new Date();

			return {
				// Amenities are resolved deterministically from the static catalog
				// (see normalizer), and the title is a proper name kept verbatim; the
				// model only localizes the free-form description and guide.
				content: {
					amenities: input.fallback.amenities,
					description: prose.description,
					descriptionSections: prose.descriptionSections,
					guide: prose.guide,
					model: this.#model,
					title: input.fallback.title,
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
		facts: listingFactsFromProjection(projection),
		fallback: projection.processedFallback,
		normalized: projection.normalized,
		sourceHash: projection.sourceHash,
	};
}

/** Verified public attributes drawn from the projection for description copy. */
function listingFactsFromProjection(
	projection: ListingCacheProjection,
): ListingLocalizationFacts {
	const amenities = projection.processedFallback.amenities
		.map((amenity) => amenity.labels.en?.trim() || amenity.sourceLabel?.trim())
		.filter((label): label is string => Boolean(label))
		.slice(0, 30);

	return {
		amenities,
		bathrooms: projection.bathrooms,
		bedrooms: projection.bedrooms,
		beds: projection.beds,
		capacity: projection.personCapacity,
		city: projection.city,
		country: projection.country,
		propertyType: projection.propertyType,
		title: (projection.normalized.title ?? projection.name ?? "").trim(),
	};
}
