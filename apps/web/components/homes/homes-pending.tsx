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

interface HomesPendingContextValue {
	isPending: boolean;
	navigate: (href: string) => void;
}

const HomesPendingContext = createContext<HomesPendingContextValue | null>(
	null,
);

export function HomesPendingProvider({ children }: { children: ReactNode }) {
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

	return <HomesPendingContext value={value}>{children}</HomesPendingContext>;
}

/**
 * Keeps the previous results visible while a filter navigation is in flight,
 * dimming them and showing a lightweight indicator instead of swapping to a
 * full skeleton. The cold-load skeleton stays on the page's Suspense fallback.
 */
export function HomesPendingResults({ children }: { children: ReactNode }) {
	const { isPending } = useHomesPending();

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

export function useHomesPending() {
	const context = useContext(HomesPendingContext);
	if (!context) {
		throw new Error("useHomesPending must be used within HomesPendingProvider");
	}
	return context;
}
