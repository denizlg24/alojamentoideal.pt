import { accommodationListing, getDb } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

const STRIPE_CONNECTED_ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/;

export interface ListingPaymentDestinationSummary {
	id: string;
	listingExternalId: string;
	listingName: string | null;
	stripeConnectedAccountId: string | null;
}

export async function listListingPaymentDestinations(): Promise<
	ListingPaymentDestinationSummary[]
> {
	return getDb()
		.select({
			id: accommodationListing.id,
			listingExternalId: accommodationListing.externalId,
			listingName: accommodationListing.name,
			stripeConnectedAccountId: accommodationListing.stripeConnectedAccountId,
		})
		.from(accommodationListing)
		.where(eq(accommodationListing.active, true))
		.orderBy(
			asc(accommodationListing.name),
			asc(accommodationListing.externalId),
		);
}

export async function setListingPaymentDestination(
	listingId: string,
	accountId: string | null,
): Promise<void> {
	const normalizedListingId = listingId.trim();
	const normalizedAccountId = accountId?.trim() || null;
	if (!normalizedListingId) {
		throw new Error("Listing is required");
	}
	if (
		normalizedAccountId &&
		!STRIPE_CONNECTED_ACCOUNT_ID.test(normalizedAccountId)
	) {
		throw new Error("Stripe connected account must start with acct_");
	}

	const [updated] = await getDb()
		.update(accommodationListing)
		.set({
			stripeConnectedAccountId: normalizedAccountId,
			updatedAt: new Date(),
		})
		.where(eq(accommodationListing.id, normalizedListingId))
		.returning({ id: accommodationListing.id });
	if (!updated) {
		throw new Error("Listing was not found");
	}
}
