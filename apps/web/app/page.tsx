import { Suspense } from "react";
import {
	FeaturedListings,
	FeaturedListingsSkeleton,
} from "@/components/home/featured-listings";
import { HeroVideo } from "@/components/home/hero-video";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { StaySearch } from "@/components/search/stay-search";
import { buildPageMetadata } from "@/lib/site/metadata";

export const metadata = buildPageMetadata({
	title: "Find Your Ideal Stay",
	description:
		"Book cozy, modern Alojamento Ideal apartments in Porto, Póvoa de Varzim, Leça da Palmeira and Canidelo.",
	path: "/",
	keywords: [
		"Porto apartments",
		"Póvoa de Varzim stays",
		"Leça da Palmeira apartments",
		"Canidelo stays",
	],
});

export default function Page() {
	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader />
			<section className="relative flex min-h-[88vh] flex-col">
				<HeroVideo />
				<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center sm:px-6">
					<span className="font-medium text-sm text-white/80 uppercase tracking-widest drop-shadow">
						Apartments across Northern Portugal
					</span>
					<h1 className="max-w-3xl text-balance font-semibold text-4xl text-white tracking-tight drop-shadow-md sm:text-5xl lg:text-6xl">
						Find the perfect place to stay.
					</h1>
					<p className="max-w-2xl text-pretty text-base text-white/90 drop-shadow sm:text-lg">
						Cozy, thoughtfully designed apartments in Porto, Póvoa de Varzim,
						Leça da Palmeira and Canidelo. Comfortable, modern and full of local
						charm, ready whenever you are.
					</p>
					<StaySearch />
					<p className="text-sm text-white/75 drop-shadow">
						Central locations · Fully equipped apartments · Guest focused
						hospitality
					</p>
				</div>
			</section>

			<main className="flex-1">
				<section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
					<div className="mb-8 flex flex-col gap-1">
						<h2 className="font-semibold text-2xl tracking-tight sm:text-3xl">
							Featured stays
						</h2>
						<p className="text-muted-foreground">
							A few of our apartments along the North Coast, ready to book.
						</p>
					</div>
					<Suspense fallback={<FeaturedListingsSkeleton />}>
						<FeaturedListings />
					</Suspense>
				</section>
			</main>

			<SiteFooter />
		</div>
	);
}
