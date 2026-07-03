import { Skeleton } from "@workspace/ui/components/skeleton";

export function CheckoutFallback() {
	return (
		<div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
			<div className="order-2 flex flex-col gap-4 lg:order-1">
				<Skeleton className="h-40 w-full rounded-2xl" />
				<Skeleton className="h-64 w-full rounded-2xl" />
			</div>
			<Skeleton className="order-1 h-72 w-full rounded-2xl lg:sticky lg:top-24 lg:order-2 lg:self-start" />
		</div>
	);
}
