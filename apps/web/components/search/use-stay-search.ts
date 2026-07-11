"use client";

import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { capacityForGuests } from "@/lib/catalog/guests";

export interface StaySearchState {
	adults: number;
	children: number;
	infants: number;
	pets: number;
	place: string | null;
	range: DateRange | undefined;
}

const DEFAULTS: StaySearchState = {
	adults: 1,
	children: 0,
	infants: 0,
	pets: 0,
	place: null,
	range: undefined,
};

/**
 * Holds the search selectors' state and turns it into a `/homes` query. The
 * chosen service area maps to the catalog list API via the `place` param (the
 * homes page resolves it to a radius search); guest capacity is sent as the
 * `guests` filter. A chosen stay period adds `checkIn`/`checkOut`, which the
 * homes page uses to run the live availability-and-quote search.
 */
export function useStaySearch(initial?: Partial<StaySearchState>) {
	const router = useRouter();
	const [state, setState] = useState<StaySearchState>({
		...DEFAULTS,
		...initial,
	});

	const guestTotal = state.adults + state.children;

	const update = (patch: Partial<StaySearchState>) =>
		setState((prev) => ({ ...prev, ...patch }));

	const buildHref = () => {
		const params = new URLSearchParams();

		if (state.place) params.set("place", state.place);
		if (state.range?.from && state.range?.to) {
			params.set("checkIn", format(state.range.from, "yyyy-MM-dd"));
			params.set("checkOut", format(state.range.to, "yyyy-MM-dd"));
		}

		params.set("adults", String(state.adults));
		params.set("children", String(state.children));
		params.set("infants", String(state.infants));
		params.set("pets", String(state.pets));
		params.set(
			"guests",
			String(capacityForGuests(state.adults, state.children)),
		);

		return `/homes?${params.toString()}`;
	};

	return {
		buildHref,
		guestTotal,
		state,
		submit: () => router.push(buildHref()),
		update,
	};
}
