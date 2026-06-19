import type { AccommodationListingProcessedContent } from "@workspace/db";

export interface ListingSearchIndexInput {
	city: string | null;
	country: string | null;
	name: string | null;
	nickname: string | null;
	processed: AccommodationListingProcessedContent;
	propertyType: string | null;
}

export interface ListingSearchIndex {
	amenityKeys: string[];
	searchBody: string;
	searchLocation: string;
	searchTitle: string;
}

/**
 * Derives the filterable amenity keys and the weighted full-text source columns
 * from the processed (localized) listing content plus typed columns. The columns
 * map to full-text weights: title (A) > location (B) > body (C). The migration
 * backfill mirrors this logic in SQL against the same `processed` JSONB, so the
 * two paths stay consistent.
 */
export function buildListingSearchIndex(
	input: ListingSearchIndexInput,
): ListingSearchIndex {
	const amenityKeys = uniqueStrings(
		input.processed.amenities.map(
			(amenity) => amenity.id ?? amenity.sourceLabel,
		),
	);

	const bodyParts: (string | null)[] = [
		input.processed.description.en,
		input.processed.description.pt,
		input.processed.description.es,
	];

	for (const amenity of input.processed.amenities) {
		bodyParts.push(
			amenity.sourceLabel,
			amenity.labels.en,
			amenity.labels.pt,
			amenity.labels.es,
		);
	}

	return {
		amenityKeys,
		searchBody: joinUnique(bodyParts),
		searchLocation: joinUnique([input.city, input.country, input.propertyType]),
		searchTitle: joinUnique([
			input.name,
			input.nickname,
			input.processed.title.en,
			input.processed.title.pt,
			input.processed.title.es,
		]),
	};
}

function joinUnique(values: (string | null | undefined)[]): string {
	return uniqueStrings(values).join(" ");
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
	const seen = new Set<string>();

	for (const value of values) {
		const trimmed = value?.trim();
		if (trimmed) {
			seen.add(trimmed);
		}
	}

	return [...seen];
}
