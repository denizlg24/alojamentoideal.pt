"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useTransition,
} from "react";

interface ActivitiesPendingContextValue {
	isPending: boolean;
	navigate: (href: string) => void;
}

const ActivitiesPendingContext =
	createContext<ActivitiesPendingContextValue | null>(null);

export function ActivitiesPendingProvider({
	children,
}: {
	children: ReactNode;
}) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	const value = useMemo(
		() => ({
			isPending,
			navigate: (href: string) =>
				startTransition(() => {
					router.push(href);
				}),
		}),
		[isPending, router],
	);

	return (
		<ActivitiesPendingContext value={value}>
			{children}
		</ActivitiesPendingContext>
	);
}

/** Dims the current results while a filter navigation is in flight. */
export function ActivitiesPendingResults({
	children,
}: {
	children: ReactNode;
}) {
	const { isPending } = useActivitiesPending();

	return (
		<div className="relative">
			<div
				aria-busy={isPending}
				className={cn(
					"transition-opacity duration-200",
					isPending && "pointer-events-none opacity-50",
				)}
			>
				{children}
			</div>
			{isPending && (
				<div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
					<span className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 font-medium text-sm shadow-sm">
						<Loader2 className="size-4 animate-spin" />
						Updating...
					</span>
				</div>
			)}
		</div>
	);
}

export function useActivitiesPending() {
	const context = useContext(ActivitiesPendingContext);
	if (!context) {
		throw new Error(
			"useActivitiesPending must be used within ActivitiesPendingProvider",
		);
	}
	return context;
}
