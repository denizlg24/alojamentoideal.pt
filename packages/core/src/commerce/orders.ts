import type { AccommodationQuoteFeeSnapshot } from "@workspace/db";
import type {
	DraftOrderContactInput,
	ListingDisplaySnapshot,
	NormalizedAccommodationQuoteSnapshot,
} from "./types";

export interface DraftOrderItemSource {
	cartItemId: string;
	position: number;
	quote: NormalizedAccommodationQuoteSnapshot;
	snapshot: ListingDisplaySnapshot;
}

export interface DraftOrderRows {
	charges: DraftOrderChargeRow[];
	contact: DraftOrderContactInput;
	detail: DraftAccommodationDetailRow;
	item: DraftOrderItemRow;
}

export interface DraftOrderItemRow {
	catalogSnapshot: ListingDisplaySnapshot;
	currency: string;
	discountMinor: number;
	imageUrlSnapshot: string | null;
	position: number;
	quantity: number;
	sourceCartItemId: string;
	status: "draft";
	subtotalMinor: number;
	taxMinor: number;
	titleSnapshot: string;
	totalMinor: number;
	type: "accommodation";
}

export interface DraftAccommodationDetailRow {
	adults: number;
	checkIn: string;
	checkOut: string;
	children: number;
	externalAccountId: string;
	guests: number;
	hostifyListingId: string;
	infants: number;
	nights: number;
	pets: number;
	propertyTimezone: string;
	provider: string;
}

export interface DraftOrderChargeRow {
	grossMinor: number;
	kind: string;
	name: string;
	netMinor: number;
	position: number;
	providerChargeId: string | null;
	quantity: string;
	rawPayload: Record<string, unknown> | null;
	taxMinor: number;
	taxRateBasisPoints: number | null;
	unitNetMinor: number;
}

export function buildDraftOrderRows(
	source: DraftOrderItemSource,
	contact: DraftOrderContactInput,
): DraftOrderRows {
	const quote = source.quote;

	return {
		charges: quote.feeLines.map((line, index) =>
			toDraftChargeRow(line, index + 1),
		),
		contact,
		detail: {
			adults: quote.adults,
			checkIn: quote.checkIn,
			checkOut: quote.checkOut,
			children: quote.children,
			externalAccountId: quote.externalAccountId,
			guests: quote.guests,
			hostifyListingId: quote.listingExternalId,
			infants: quote.infants,
			nights: quote.nights,
			pets: quote.pets,
			propertyTimezone: source.snapshot.propertyTimezone,
			provider: quote.provider,
		},
		item: {
			catalogSnapshot: source.snapshot,
			currency: quote.currency,
			discountMinor: 0,
			imageUrlSnapshot: source.snapshot.imageUrl,
			position: source.position,
			quantity: 1,
			sourceCartItemId: source.cartItemId,
			status: "draft",
			subtotalMinor: quote.subtotalMinor,
			taxMinor: quote.taxMinor,
			titleSnapshot: source.snapshot.title,
			totalMinor: quote.totalMinor,
			type: "accommodation",
		},
	};
}

export function generatePublicOrderReference(now = new Date()): string {
	const year = now.getUTCFullYear();
	const suffix = crypto
		.randomUUID()
		.replace(/-/g, "")
		.slice(0, 6)
		.toUpperCase();
	return `AI-${year}-${suffix}`;
}

function toDraftChargeRow(
	line: AccommodationQuoteFeeSnapshot,
	position: number,
): DraftOrderChargeRow {
	const kind = chargeKind(line);
	const taxMinor =
		kind === "tax" ? line.totalMinor : (line.inclusiveTaxMinor ?? 0);
	const rawNetMinor = line.totalMinor - taxMinor;
	const netMinor = line.totalMinor < 0 ? rawNetMinor : Math.max(0, rawNetMinor);
	const quantity = line.quantity ?? 1;

	return {
		grossMinor: line.totalMinor,
		kind,
		name: line.name,
		netMinor,
		position,
		providerChargeId: null,
		quantity: quantity.toFixed(2),
		rawPayload: line.providerPayload,
		taxMinor,
		taxRateBasisPoints: null,
		unitNetMinor: Math.round(netMinor / Math.max(quantity, 1)),
	};
}

function chargeKind(line: AccommodationQuoteFeeSnapshot): string {
	if (line.isBasePrice) {
		return "accommodation";
	}
	if (line.type === "tax") {
		return "tax";
	}
	if (line.type === "discount") {
		return "discount";
	}
	return "fee";
}
