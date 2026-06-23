import { Skeleton } from "@workspace/ui/components/skeleton";

export default function BookLoading() {
	return (
		<div className="flex min-h-screen flex-col bg-muted/20">
			<div className="h-16 border-b bg-background" />
			<main className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
				<div className="flex flex-col gap-4">
					<Skeleton className="h-40 w-full rounded-2xl" />
					<Skeleton className="h-64 w-full rounded-2xl" />
					<Skeleton className="h-48 w-full rounded-2xl" />
				</div>
				<Skeleton className="h-80 w-full rounded-2xl" />
			</main>
		</div>
	);
}
