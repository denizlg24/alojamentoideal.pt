"use client";

import { useEffect, useState } from "react";

/** Listing facts the stay editor needs, fetched once per listing. */
export interface ListingConstraints {
	maxGuests: number | null;
	minNights: number;
}

export const DEFAULT_LISTING_CONSTRAINTS: ListingConstraints = {
	maxGuests: null,
	minNights: 1,
};

async function fetchConstraints(
	listingId: string,
): Promise<[string, ListingConstraints]> {
	try {
		const response = await fetch(
			`/api/catalog/listings/${encodeURIComponent(listingId)}`,
		);
		if (!response.ok) {
			return [listingId, DEFAULT_LISTING_CONSTRAINTS];
		}
		const payload = (await response.json()) as {
			data?: { capacity?: { guests?: number }; minNights?: number };
		};
		return [
			listingId,
			{
				maxGuests: payload.data?.capacity?.guests ?? null,
				minNights: payload.data?.minNights ?? 1,
			},
		];
	} catch {
		return [listingId, DEFAULT_LISTING_CONSTRAINTS];
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
			const loaded = await Promise.all(toFetch.map(fetchConstraints));
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
