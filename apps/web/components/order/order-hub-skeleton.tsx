import { Skeleton } from "@workspace/ui/components/skeleton";
import { SiteHeader } from "@/components/home/site-header";

/** Streaming fallback for an order-hub section while access + data resolve. */
export function OrderHubSkeleton() {
	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader solid />
			<main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-24 pb-16 sm:px-6">
				<div className="flex flex-col gap-6">
					<div className="flex items-start gap-4">
						<Skeleton className="size-20 rounded-xl sm:size-24" />
						<div className="flex flex-col gap-2">
							<Skeleton className="h-7 w-48" />
							<Skeleton className="h-4 w-40" />
							<Skeleton className="h-5 w-24 rounded-full" />
						</div>
					</div>
					<Skeleton className="h-10 w-full max-w-sm" />
					<div className="flex flex-col gap-3">
						<Skeleton className="h-24 w-full rounded-2xl" />
						<Skeleton className="h-40 w-full rounded-2xl" />
					</div>
				</div>
			</main>
		</div>
	);
}
