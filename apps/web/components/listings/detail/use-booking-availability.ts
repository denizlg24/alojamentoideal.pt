"use client";

import { useEffect, useState } from "react";
import type { BookingAvailability } from "@/lib/catalog/availability";

export type AvailabilityState =
	| { status: "loading" }
	| { status: "ready"; availability: BookingAvailability }
	| { status: "error" };

/**
 * Loads a listing's synced booking calendar on mount. Kept client-side so the
 * listing page can be statically prerendered; the calendar (which changes on
 * every nightly sync) is fetched per visit instead of baked into the HTML.
 */
export function useBookingAvailability(
	listingId: string,
	minNights: number,
): AvailabilityState {
	const [state, setState] = useState<AvailabilityState>({ status: "loading" });

	useEffect(() => {
		const controller = new AbortController();
		setState({ status: "loading" });
		const params = new URLSearchParams({
			listingId,
			minNights: String(minNights),
		});

		fetch(`/api/accommodations/calendar?${params.toString()}`, {
			signal: controller.signal,
		})
			.then(async (response) => {
				if (!response.ok) {
					throw new Error("Failed to load availability");
				}
				const json = (await response.json()) as { data: BookingAvailability };
				if (!controller.signal.aborted) {
					setState({ availability: json.data, status: "ready" });
				}
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setState({ status: "error" });
				}
			});

		return () => controller.abort();
	}, [listingId, minNights]);

	return state;
}
