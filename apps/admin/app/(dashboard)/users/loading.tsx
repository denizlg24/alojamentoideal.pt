import { Skeleton } from "@workspace/ui/components/skeleton";

export default function UsersLoading() {
	return (
		<div className="mx-auto max-w-5xl">
			<Skeleton className="h-7 w-24" />
			<Skeleton className="mt-2 h-4 w-72" />
			<div className="mt-8 space-y-3">
				{["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"].map((key) => (
					<Skeleton className="h-9 w-full" key={key} />
				))}
			</div>
		</div>
	);
}
