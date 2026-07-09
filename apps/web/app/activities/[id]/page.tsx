import { difficultyLabel } from "@workspace/core/activities";
import { Badge } from "@workspace/ui/components/badge";
import { ChevronLeft, Clock, Gauge, MapPin, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActivityBooking } from "@/components/activities/detail/activity-booking";
import { ActivityBookingSkeleton } from "@/components/activities/detail/activity-booking-skeleton";
import { ActivityCancellationPolicy } from "@/components/activities/detail/activity-cancellation-policy";
import { ActivityDescription } from "@/components/activities/detail/activity-description";
import { ActivityFacts } from "@/components/activities/detail/activity-facts";
import { ActivityGallery } from "@/components/activities/detail/activity-gallery";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { formatActivityMoney, formatDuration } from "@/lib/activities/format";
import {
	generateActivityStaticParams,
	getActivityCatalogScope,
	getActivityCurrency,
	getCachedActivityDetail,
} from "@/lib/activities/source";
import { buildPageMetadata } from "@/lib/site/metadata";

export function generateStaticParams() {
	return generateActivityStaticParams();
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const activity = await getCachedActivityDetail(id, getActivityCatalogScope());
	if (!activity) {
		return buildPageMetadata({
			title: "Activity",
			description: "Browse tours and experiences along Portugal's North Coast.",
			path: `/activities/${id}`,
		});
	}
	return buildPageMetadata({
		title: activity.title,
		description:
			activity.excerpt ??
			`Book ${activity.title} with live availability and per-person pricing.`,
		path: `/activities/${id}`,
	});
}

export default async function ActivityDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	if (id === "__ci_placeholder__") {
		notFound();
	}

	const activity = await getCachedActivityDetail(id, getActivityCatalogScope());
	if (!activity) notFound();
	const activityCurrency = getActivityCurrency();

	const duration = formatDuration(activity.duration);
	const location = activity.location?.city ?? null;
	const fromPrice = formatActivityMoney(activity.fromPrice);

	return (
		<div className="flex min-h-svh flex-col">
			<SiteHeader solid />
			<main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-16 pb-28 sm:px-6 lg:px-8 lg:pb-10">
				<Link
					href="/activities"
					className="mt-8 mb-4 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				>
					<ChevronLeft className="size-4" />
					All activities
				</Link>

				<div className="flex flex-col gap-6">
					<ActivityGallery
						galleryHref={`/activities/${activity.id}/gallery`}
						photos={activity.photos}
						title={activity.title}
					/>

					<div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(340px,400px)]">
						<div className="flex flex-col gap-8">
							<header className="flex flex-col gap-3">
								<h1 className="font-heading font-semibold text-3xl tracking-tight">
									{activity.title}
								</h1>
								<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-sm">
									{activity.rating !== null && (
										<span className="flex items-center gap-1 font-medium text-foreground">
											<Star className="size-4 fill-amber-500 text-amber-500" />
											{activity.rating.toFixed(1)}
											{activity.reviewCount !== null && (
												<span className="font-normal text-muted-foreground">
													({activity.reviewCount})
												</span>
											)}
										</span>
									)}
									{duration && (
										<span className="flex items-center gap-1.5">
											<Clock className="size-4" />
											{duration}
										</span>
									)}
									{activity.difficulty && (
										<span className="flex items-center gap-1.5">
											<Gauge className="size-4" />
											{difficultyLabel(activity.difficulty)}
										</span>
									)}
									{location && (
										<span className="flex items-center gap-1.5">
											<MapPin className="size-4" />
											{location}
										</span>
									)}
								</div>
								{activity.attributes.length > 0 && (
									<div className="flex flex-wrap gap-2">
										{activity.attributes.map((attribute) => (
											<Badge key={attribute} variant="outline">
												{attribute}
											</Badge>
										))}
									</div>
								)}
							</header>

							<ActivityFacts activity={activity} />
							<ActivityDescription activity={activity} />
							<ActivityCancellationPolicy activity={activity} />
						</div>

						<div className="lg:pt-1">
							{fromPrice && (
								<p className="mb-4 text-muted-foreground text-sm lg:hidden">
									From{" "}
									<span className="font-semibold text-foreground">
										{fromPrice}
									</span>{" "}
									per person
								</p>
							)}
							<Suspense fallback={<ActivityBookingSkeleton />}>
								<ActivityBooking
									activity={activity}
									currency={activityCurrency}
								/>
							</Suspense>
						</div>
					</div>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
