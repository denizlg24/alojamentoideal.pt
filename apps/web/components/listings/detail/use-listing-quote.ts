"use client";

import type { AccommodationQuoteResult } from "@workspace/core/accommodations";
import { useEffect, useState } from "react";
import {
	fetchListingQuote,
	type QuoteFailureCode,
} from "@/lib/catalog/quote-client";

export type QuoteState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; quote: AccommodationQuoteResult }
	| { status: "unavailable"; quote: AccommodationQuoteResult }
	| { code: QuoteFailureCode; message: string; status: "error" };

interface UseListingQuoteArgs {
	adults: number;
	checkIn: string | null;
	checkOut: string | null;
	children: number;
	enabled?: boolean;
	guests: number;
	listingId: string;
}

const DEBOUNCE_MS = 350;

/**
 * Fetches a live quote whenever the stay or guest count changes, debounced and
 * with stale responses aborted so a fast edit never lands an outdated price. An
 * `available: false` quote becomes the `unavailable` state the booking card uses
 * to tell the visitor the period is no longer bookable.
 */
export function useListingQuote({
	adults,
	checkIn,
	checkOut,
	children,
	enabled = true,
	guests,
	listingId,
}: UseListingQuoteArgs): QuoteState {
	const [state, setState] = useState<QuoteState>({ status: "idle" });

	useEffect(() => {
		if (!enabled || !checkIn || !checkOut) {
			setState({ status: "idle" });
			return;
		}

		const controller = new AbortController();
		setState({ status: "loading" });

		const timer = setTimeout(() => {
			fetchListingQuote({
				adults,
				checkIn,
				checkOut,
				children,
				guests,
				listingId,
				signal: controller.signal,
			})
				.then((result) => {
					if (controller.signal.aborted) return;
					if (!result.ok) {
						setState({
							code: result.code,
							message: result.message,
							status: "error",
						});
						return;
					}
					setState({
						quote: result.quote,
						status: result.quote.available ? "ready" : "unavailable",
					});
				})
				.catch(() => {
					if (controller.signal.aborted) return;
					setState({
						code: "network_error",
						message:
							"Pricing is temporarily unavailable. Please try again in a moment.",
						status: "error",
					});
				});
		}, DEBOUNCE_MS);

		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [adults, checkIn, checkOut, children, enabled, guests, listingId]);

	return state;
}
