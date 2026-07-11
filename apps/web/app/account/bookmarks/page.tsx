import { Button } from "@workspace/ui/components/button";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import {
	ListingCard,
	ListingCardSkeleton,
} from "@/components/listings/listing-card";
import {
	accountBookmarkRepository,
	bookmarkScope,
} from "@/lib/account/bookmarks";
import { getCurrentUser } from "@/lib/auth/session";
import { getCachedCatalogDetail } from "@/lib/catalog/cache";
import { buildPrivatePageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivatePageMetadata({
	title: "Your bookmarks",
	description: "Homes you saved for a future stay with Alojamento Ideal.",
});

async function BookmarksData() {
	const user = await getCurrentUser();
	if (!user) {
		redirect("/login?next=/account/bookmarks");
	}

	const scope = bookmarkScope();
	const listingIds = await accountBookmarkRepository().listListingExternalIds(
		user.id,
		scope,
	);
	const listings = (
		await Promise.all(
			listingIds.map((externalId) =>
				getCachedCatalogDetail(externalId, scope, "en"),
			),
		)
	).filter((listing) => listing !== null);

	if (listings.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
				<p className="font-medium">No saved homes yet</p>
				<p className="text-muted-foreground text-sm">
					Tap the bookmark on any home to keep it here for later.
				</p>
				<Button asChild className="mt-2 rounded-full" size="sm">
					<Link href="/homes">Browse homes</Link>
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{listings.map((listing) => (
				<ListingCard key={listing.id} layout="row" listing={listing} />
			))}
		</div>
	);
}

export default function BookmarksPage() {
	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-24 pb-16 sm:px-6">
				<header className="pb-6">
					<h1 className="font-heading font-semibold text-3xl">Bookmarks</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Homes you saved for a future stay.
					</p>
				</header>
				<Suspense
					fallback={
						<div className="flex flex-col gap-4">
							<ListingCardSkeleton layout="row" />
							<ListingCardSkeleton layout="row" />
						</div>
					}
				>
					<BookmarksData />
				</Suspense>
			</main>
			<SiteFooter />
		</div>
	);
}
