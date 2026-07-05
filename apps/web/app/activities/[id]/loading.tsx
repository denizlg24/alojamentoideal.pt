import { Skeleton } from "@workspace/ui/components/skeleton";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";

export default function ActivityDetailLoading() {
	return (
		<div className="flex min-h-svh flex-col">
			<SiteHeader solid />
			<main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-16 pb-28 sm:px-6 lg:px-8 lg:pb-10">
				<div className="flex flex-col gap-6 mt-8">
					<Skeleton className="aspect-[16/10] w-full rounded-2xl md:aspect-[2/1]" />
					<div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(340px,400px)]">
						<div className="flex flex-col gap-6">
							<Skeleton className="h-9 w-2/3" />
							<Skeleton className="h-5 w-1/2" />
							<Skeleton className="h-40 w-full" />
							<Skeleton className="h-64 w-full" />
						</div>
						<Skeleton className="hidden h-96 w-full rounded-2xl lg:block" />
					</div>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
