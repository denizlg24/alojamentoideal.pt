import { Skeleton } from "@workspace/ui/components/skeleton";
import { ActivitiesResultsSkeleton } from "@/components/activities/activities-results";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";

export default function ActivitiesLoading() {
	return (
		<div className="flex min-h-svh flex-col">
			<SiteHeader solid />
			<main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-16 sm:px-6 lg:px-8">
				<div className="flex flex-col gap-8 py-8">
					<div className="flex flex-col gap-2">
						<Skeleton className="h-9 w-48" />
						<Skeleton className="h-5 w-full max-w-2xl" />
					</div>
					<ActivitiesResultsSkeleton />
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
