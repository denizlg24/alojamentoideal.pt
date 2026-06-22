import { CommerceError } from "./errors";

export interface QuoteTotalsInput {
	currency: string;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
	validationStatus: string;
}

export interface CartTotals {
	currency: string;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
	totalItems: number;
	validItemCount: number;
}

export function sumCartTotals(
	items: QuoteTotalsInput[],
	defaultCurrency: string,
): CartTotals {
	const totals: CartTotals = {
		currency: defaultCurrency,
		subtotalMinor: 0,
		taxMinor: 0,
		totalMinor: 0,
		totalItems: items.length,
		validItemCount: 0,
	};

	for (const item of items) {
		if (item.validationStatus !== "valid") {
			continue;
		}

		if (totals.validItemCount === 0) {
			totals.currency = item.currency;
		}
		if (item.currency !== totals.currency) {
			throw new CommerceError(
				"invalid_request",
				"Cart items must use a single currency.",
				422,
			);
		}

		totals.subtotalMinor += item.subtotalMinor;
		totals.taxMinor += item.taxMinor;
		totals.totalMinor += item.totalMinor;
		totals.validItemCount += 1;
	}

	return totals;
}
