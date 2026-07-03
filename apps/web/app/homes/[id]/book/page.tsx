import type { CatalogListingDetailDto } from "@workspace/core/catalog";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Star } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckoutController } from "@/components/checkout/checkout-controller";
import { CheckoutHeader } from "@/components/checkout/checkout-header";
import type { CheckoutSeed } from "@/components/checkout/types";
import { getCachedCatalogDetail } from "@/lib/catalog/cache";
import { capacityForGuests, MAX_INFANTS } from "@/lib/catalog/guests";
import {
	generateListingStaticParams,
	getListingCatalogScope,
} from "@/lib/catalog/listing-route";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Confirm and pay",
	description:
		"Review your stay, guest details and secure payment for an Alojamento Ideal booking.",
});

type SearchParams = Record<string, string | string[] | undefined>;

interface BookPageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<SearchParams>;
}

export async function generateStaticParams(): Promise<{ id: string }[]> {
	return generateListingStaticParams();
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

function locationLabelOf(listing: CatalogListingDetailDto): string | null {
	return (
		[listing.location.city, listing.location.country]
			.filter(Boolean)
			.join(", ") || null
	);
}

/**
 * Prerendered shell shown while the interactive checkout streams in. Mirrors
 * the live cart summary header (cover, title, rating) so the swap is seamless;
 * the stay/price rows are the only placeholders, since those depend on the
 * request's search params.
 */
async function CheckoutShell({ id }: { id: string }) {
	const listing = await getCachedCatalogDetail(
		id,
		getListingCatalogScope(),
		"en",
	);
	const locationLabel = listing ? locationLabelOf(listing) : null;

	return (
		<div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
			<div className="order-2 flex flex-col gap-4 lg:order-1">
				<Skeleton className="h-40 w-full rounded-2xl" />
				<Skeleton className="h-64 w-full rounded-2xl" />
				<Skeleton className="h-48 w-full rounded-2xl" />
			</div>
			<aside className="order-1 lg:sticky lg:top-24 lg:order-2 lg:self-start">
				<div className="rounded-2xl border bg-card p-5 shadow-sm">
					<div className="flex gap-3">
						<div
							className="size-20 shrink-0 rounded-xl bg-center bg-cover bg-muted"
							style={
								listing?.coverPhoto?.url
									? { backgroundImage: `url(${listing.coverPhoto.url})` }
									: undefined
							}
						/>
						<div className="flex min-w-0 flex-col justify-center gap-1">
							<span className="line-clamp-2 font-medium text-sm">
								{listing?.title ?? <Skeleton className="h-4 w-32" />}
							</span>
							{listing && listing.reviews.average !== null && (
								<span className="flex items-center gap-1 text-muted-foreground text-xs">
									<Star className="size-3.5 fill-foreground text-foreground" />
									{listing.reviews.average.toFixed(2)} · {listing.reviews.count}
								</span>
							)}
							{locationLabel && (
								<span className="text-muted-foreground text-xs">
									{locationLabel}
								</span>
							)}
						</div>
					</div>
					<Separator className="my-4" />
					<div className="flex flex-col gap-3">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
					<Separator className="my-4" />
					<Skeleton className="h-6 w-full" />
				</div>
			</aside>
		</div>
	);
}

/**
 * Request-time island: reads the stay from search params and hands the seed to
 * the shared-cart checkout controller, which ensures this stay is in the cart
 * (alongside anything already added) before payment.
 */
async function CheckoutDynamic({
	id,
	searchParams,
}: {
	id: string;
	searchParams: BookPageProps["searchParams"];
}) {
	const listing = await getCachedCatalogDetail(
		id,
		getListingCatalogScope(),
		"en",
	);
	if (!listing) {
		notFound();
	}
	const query = await searchParams;

	const adults = readInt(query.adults, 1, 1, 30);
	const children = readInt(query.children, 0, 0, 30);
	const infants = readInt(query.infants, 0, 0, MAX_INFANTS);
	const guests = readInt(
		query.guests,
		capacityForGuests(adults, children),
		1,
		30,
	);

	const seed: CheckoutSeed = {
		adults,
		checkIn: readString(query.checkIn),
		checkOut: readString(query.checkOut),
		children,
		guests,
		infants,
		listingId: listing.id,
	};

	// Key the live controller on the stay so a navigation that lands here with
	// different search params (a fresh reserve) remounts it and re-runs the
	// once-only bootstrap, instead of the router cache reusing a mounted instance
	// still holding the previous stay.
	const stayKey = [
		id,
		seed.checkIn ?? "",
		seed.checkOut ?? "",
		seed.adults,
		seed.children,
		seed.infants,
		seed.guests,
	].join("|");

	return <CheckoutController key={stayKey} seed={seed} />;
}

export default async function BookPage(props: BookPageProps) {
	const { id } = await props.params;

	if (id === "__ci_placeholder__") {
		notFound();
	}

	return (
		<div className="flex min-h-screen flex-col bg-muted/20">
			<CheckoutHeader backHref={`/homes/${id}`} />
			<main className="flex-1">
				<Suspense fallback={<CheckoutShell id={id} />}>
					<CheckoutDynamic id={id} searchParams={props.searchParams} />
				</Suspense>
			</main>
		</div>
	);
}
