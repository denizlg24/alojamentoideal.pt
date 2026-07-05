import type {
	ActivityDeparture,
	ActivityDepartureRate,
	ActivityParticipantSelection,
	ActivityPricingCategory,
} from "./types";

/** Total participants across all pricing categories. */
export function totalParticipants(
	selection: ActivityParticipantSelection,
): number {
	return Object.values(selection).reduce((sum, count) => sum + count, 0);
}

/**
 * Seats consumed from an availability for a selection. A category's `occupancy`
 * is how many seats one ticket takes (e.g. a "family of 4" ticket occupies 4).
 */
export function occupiedSeats(
	selection: ActivityParticipantSelection,
	categories: ActivityPricingCategory[],
): number {
	const occupancyById = new Map(
		categories.map((category) => [category.id, category.occupancy]),
	);
	let seats = 0;
	for (const [categoryId, count] of Object.entries(selection)) {
		seats += count * (occupancyById.get(categoryId) ?? 1);
	}
	return seats;
}

/** The rate a booking defaults to: the departure's default, else the first. */
export function defaultRate(
	departure: ActivityDeparture,
): ActivityDepartureRate | null {
	if (departure.defaultRateId !== null) {
		const match = departure.rates.find(
			(rate) => rate.id === departure.defaultRateId,
		);
		if (match) return match;
	}
	return departure.rates[0] ?? null;
}

/**
 * Per-unit price for `count` participants of a category on a rate. Bokun tiers
 * price by group size (`minParticipants`..`maxParticipants`); the first tier
 * containing `count` wins. Null when the rate does not price the category.
 */
export function rateUnitPrice(
	rate: ActivityDepartureRate,
	categoryId: string,
	count: number,
): number | null {
	const tiers = rate.tiersByCategory[categoryId];
	if (!tiers || tiers.length === 0) return null;
	const tier =
		tiers.find(
			(entry) =>
				count >= entry.minParticipants &&
				(entry.maxParticipants === null || count <= entry.maxParticipants),
		) ?? tiers[tiers.length - 1];
	return tier?.amount ?? null;
}

/**
 * Price of a selection on a rate, in the calendar currency. Null when any
 * selected category is unpriced (which also blocks booking in validation).
 */
export function computeRateTotal(
	rate: ActivityDepartureRate,
	selection: ActivityParticipantSelection,
): number | null {
	if (!rate.pricedPerPerson && rate.pricePerBooking !== null) {
		return totalParticipants(selection) > 0 ? rate.pricePerBooking : null;
	}
	let total = 0;
	let priced = false;
	for (const [categoryId, count] of Object.entries(selection)) {
		if (count <= 0) continue;
		const unit = rateUnitPrice(rate, categoryId, count);
		if (unit === null) return null;
		total += rate.pricedPerPerson ? unit * count : unit;
		priced = true;
	}
	return priced ? total : null;
}

/** Price of a selection on a departure's default rate. */
export function computeDepartureTotal(
	departure: ActivityDeparture,
	selection: ActivityParticipantSelection,
): number | null {
	const rate = defaultRate(departure);
	if (rate === null) return null;
	return computeRateTotal(rate, selection);
}

export interface DepartureSelectionIssue {
	reason: "empty" | "below_min" | "sold_out" | "over_capacity" | "unpriced";
	minParticipants?: number;
	availableSeats?: number;
}

/**
 * Validates a participant selection against a departure. Returns the blocking
 * issue, or null when the selection is bookable. Pure so both the widget and a
 * future server-side reserve can share the rules.
 */
export function validateDepartureSelection(
	departure: ActivityDeparture,
	selection: ActivityParticipantSelection,
	categories: ActivityPricingCategory[],
	rate?: ActivityDepartureRate | null,
): DepartureSelectionIssue | null {
	if (departure.soldOut) return { reason: "sold_out" };

	const participants = totalParticipants(selection);
	if (participants <= 0) return { reason: "empty" };

	const activeRate = rate ?? defaultRate(departure);
	const minRequired = Math.max(
		departure.minParticipants,
		activeRate?.minPerBooking ?? 1,
	);
	if (participants < minRequired) {
		return { reason: "below_min", minParticipants: minRequired };
	}

	const seats = occupiedSeats(selection, categories);
	if (
		departure.availabilityCount != null &&
		seats > departure.availabilityCount
	) {
		return {
			reason: "over_capacity",
			availableSeats: departure.availabilityCount,
		};
	}
	if (
		activeRate?.maxPerBooking != null &&
		participants > activeRate.maxPerBooking
	) {
		return {
			reason: "over_capacity",
			availableSeats: activeRate.maxPerBooking,
		};
	}

	if (activeRate === null || computeRateTotal(activeRate, selection) === null) {
		return { reason: "unpriced" };
	}

	return null;
}
