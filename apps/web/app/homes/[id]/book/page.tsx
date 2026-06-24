import { getAccommodationsConfig } from "@workspace/core/accommodations";
import { Skeleton } from "@workspace/ui/components/skeleton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckoutController } from "@/components/checkout/checkout-controller";
import { CheckoutHeader } from "@/components/checkout/checkout-header";
import type { InitialListing, InitialStay } from "@/components/checkout/types";
import { getCachedCatalogDetail } from "@/lib/catalog/cache";
import { capacityForGuests, MAX_INFANTS } from "@/lib/catalog/guests";
import { getListingCatalogScope } from "@/lib/catalog/listing-route";

export const metadata: Metadata = {
	title: "Confirm and pay",
};

type SearchParams = Record<string, string | string[] | undefined>;

interface BookPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<SearchParams>;
}

function readInt(
	value: string | string[] | undefined,
	fallback: number,
	min: number,
	max?: number,
): number {
	const raw = Array.isArray(value) ? value[0] : value;
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
	const boundedFallback =
		max !== undefined
			? Math.min(Math.max(fallback, min), max)
			: Math.max(fallback, min);
	if (!Number.isFinite(parsed) || parsed < min) {
		return boundedFallback;
	}
	return max !== undefined ? Math.min(parsed, max) : parsed;
}

function readString(value: string | string[] | undefined): string | null {
	const raw = Array.isArray(value) ? value[0] : value;
	return raw && raw.length > 0 ? raw : null;
}

async function BookContent({ params, searchParams }: BookPageProps) {
	const { id } = await params;

	if (id === "__ci_placeholder__") {
		notFound();
	}

	const listing = await getCachedCatalogDetail(
		id,
		getListingCatalogScope(),
		"en",
	);
	if (!listing) {
		notFound();
	}

	const query = await searchParams;
	const config = getAccommodationsConfig();

	const adults = readInt(query.adults, 1, 1, 30);
	const children = readInt(query.children, 0, 0, 30);
	const infants = readInt(query.infants, 0, 0, MAX_INFANTS);
	const guests = readInt(
		query.guests,
		capacityForGuests(adults, children),
		1,
		30,
	);

	const locationLabel =
		[listing.location.city, listing.location.country]
			.filter(Boolean)
			.join(", ") || null;

	const initialListing: InitialListing = {
		coverPhotoUrl: listing.coverPhoto?.url ?? null,
		currency: config.currency,
		id: listing.id,
		locationLabel,
		maxGuests: listing.capacity.guests,
		minNights: listing.minNights,
		petsAllowed: false,
		reviewAverage: listing.reviews.average,
		reviewCount: listing.reviews.count,
		title: listing.title,
	};

	const initialStay: InitialStay = {
		adults,
		checkIn: readString(query.checkIn),
		checkOut: readString(query.checkOut),
		children,
		guests,
		infants,
	};

	return (
		<CheckoutController
			initialListing={initialListing}
			initialStay={initialStay}
		/>
	);
}

function BookSkeleton() {
	return (
		<div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
			<div className="flex flex-col gap-4">
				<Skeleton className="h-40 w-full rounded-2xl" />
				<Skeleton className="h-64 w-full rounded-2xl" />
			</div>
			<Skeleton className="h-80 w-full rounded-2xl" />
		</div>
	);
}

export default async function BookPage(props: BookPageProps) {
	const { id } = await props.params;
	return (
		<div className="flex min-h-screen flex-col bg-muted/20">
			<CheckoutHeader backHref={`/homes/${id}`} />
			<main className="flex-1">
				<Suspense fallback={<BookSkeleton />}>
					<BookContent
						params={props.params}
						searchParams={props.searchParams}
					/>
				</Suspense>
			</main>
		</div>
	);
}
