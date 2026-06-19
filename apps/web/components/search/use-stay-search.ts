"use client";

import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

export interface StaySearchState {
	adults: number;
	children: number;
	location: string;
	range: DateRange | undefined;
}

const DEFAULTS: StaySearchState = {
	adults: 1,
	children: 0,
	location: "",
	range: undefined,
};

/**
 * Holds the search selectors' state and turns it into a `/homes` query. Capacity
 * (adults + children) maps to the catalog list API's `guests` filter; the stay
 * period is captured for later but does not filter yet, since availability is
 * not wired up.
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
		const location = state.location.trim();

		if (location) params.set("q", location);
		if (state.range?.from)
			params.set("checkIn", format(state.range.from, "yyyy-MM-dd"));
		if (state.range?.to)
			params.set("checkOut", format(state.range.to, "yyyy-MM-dd"));

		params.set("adults", String(state.adults));
		params.set("children", String(state.children));
		params.set("guests", String(guestTotal));

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
