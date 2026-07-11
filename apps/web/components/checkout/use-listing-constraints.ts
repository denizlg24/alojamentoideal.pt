"use client";

import { useEffect, useState } from "react";
import { MAX_PETS } from "@/lib/catalog/guests";

/** Listing facts the stay editor needs, fetched once per listing. */
export interface ListingConstraints {
	maxGuests: number | null;
	maxPets: number;
	minNights: number;
}

export const DEFAULT_LISTING_CONSTRAINTS: ListingConstraints = {
	maxGuests: null,
	maxPets: 0,
	minNights: 1,
};

async function fetchConstraints(
	listingId: string,
): Promise<[string, ListingConstraints] | null> {
	try {
		const response = await fetch(
			`/api/catalog/listings/${encodeURIComponent(listingId)}`,
		);
		if (!response.ok) {
			return null;
		}
		const payload = (await response.json()) as {
			data?: {
				capacity?: { guests?: number };
				minNights?: number;
				petFriendly?: boolean;
			};
		};
		return [
			listingId,
			{
				maxGuests: payload.data?.capacity?.guests ?? null,
				maxPets: payload.data?.petFriendly ? MAX_PETS : 0,
				minNights: payload.data?.minNights ?? 1,
			},
		];
	} catch {
		return null;
	}
}

/**
 * Resolves the edit-dialog constraints (max guests, min nights) for each unique
 * listing id, fetching any not yet cached. Shared by the `/cart` page and the
 * checkout summary so both drive the same stay editor.
 */
export function useListingConstraints(
	listingIds: string[],
): Map<string, ListingConstraints> {
	const [constraints, setConstraints] = useState<
		Map<string, ListingConstraints>
	>(new Map());

	// Stable key so a fresh array with the same ids does not re-run the effect.
	const idsKey = [...new Set(listingIds)].sort().join(",");

	// biome-ignore lint/correctness/useExhaustiveDependencies: idsKey stands in for listingIds; constraints is read via the functional updater to avoid a fetch loop.
	useEffect(() => {
		const missing = idsKey
			.split(",")
			.filter((listingId) => listingId.length > 0);
		let cancelled = false;
		const run = async () => {
			const toFetch = missing.filter(
				(listingId) => !constraints.has(listingId),
			);
			if (toFetch.length === 0) {
				return;
			}
			const loaded = (await Promise.all(toFetch.map(fetchConstraints))).filter(
				(entry): entry is [string, ListingConstraints] => entry !== null,
			);
			if (loaded.length === 0) {
				return;
			}
			if (!cancelled) {
				setConstraints((current) => new Map([...current, ...loaded]));
			}
		};
		void run();
		return () => {
			cancelled = true;
		};
	}, [idsKey]);

	return constraints;
}
