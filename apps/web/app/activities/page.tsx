import { Suspense } from "react";
import { ActivitiesFilterBar } from "@/components/activities/activities-filter-bar";
import { ActivitiesLocationRail } from "@/components/activities/activities-location-rail";
import {
	ActivitiesPendingProvider,
	ActivitiesPendingResults,
} from "@/components/activities/activities-pending";
import {
	ActivitiesResults,
	ActivitiesResultsSkeleton,
} from "@/components/activities/activities-results";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import {
	applyActivitiesFilters,
	computeActivitiesFacets,
	parseActivitiesFilters,
} from "@/lib/activities/filters";
import {
	getActivityCatalogScope,
	getCachedActivitySummaries,
} from "@/lib/activities/source";
import { buildPageMetadata } from "@/lib/site/metadata";

export const metadata = buildPageMetadata({
	title: "Activities",
	description:
		"Book local tours and experiences along Portugal's North Coast, from Porto walks to boat trips, with live availability and per-person pricing.",
	path: "/activities",
	keywords: [
		"things to do in Porto",
		"activities in Northern Portugal",
		"Porto tours and experiences",
	],
});

type SearchParams = Record<string, string | string[] | undefined>;

async function ActivitiesContent({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const resolved = await searchParams;
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(resolved)) {
		if (Array.isArray(value)) {
			for (const entry of value) params.append(key, entry);
		} else if (value !== undefined) {
			params.set(key, value);
		}
	}

	const summaries = await getCachedActivitySummaries(getActivityCatalogScope());
	const facets = computeActivitiesFacets(summaries);
	const filters = parseActivitiesFilters(params);
	const activities = applyActivitiesFilters(summaries, filters);

	return (
		<ActivitiesPendingProvider>
			<div className="flex flex-col gap-6">
				<ActivitiesLocationRail placeIds={facets.placeIds} />
				<ActivitiesFilterBar facets={facets} />
				<ActivitiesPendingResults>
					<ActivitiesResults activities={activities} />
				</ActivitiesPendingResults>
			</div>
		</ActivitiesPendingProvider>
	);
}

export default function ActivitiesPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	return (
		<div className="flex min-h-svh flex-col">
			<SiteHeader solid />
			<main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-16 sm:px-6 lg:px-8">
				<div className="flex flex-col gap-8 py-8">
					<Suspense fallback={<ActivitiesResultsSkeleton />}>
						<ActivitiesContent searchParams={searchParams} />
					</Suspense>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
