"use client";

import { useRouter } from "next/navigation";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useSession } from "@/lib/auth/client";

interface SavedListingsContextValue {
	isSaved: (listingId: string) => boolean;
	/** Saves or removes a listing; opens the login overlay when signed out. */
	toggle: (listingId: string) => void;
}

const SavedListingsContext = createContext<SavedListingsContextValue | null>(
	null,
);

/**
 * Client-side cache of the signed-in user's bookmarked listing ids. Listing
 * cards render from cached, user-agnostic server responses, so the saved state
 * hydrates here (one fetch per session) instead of being baked into the page.
 */
export function SavedListingsProvider({ children }: { children: ReactNode }) {
	const { data: session } = useSession();
	const { openAuth } = useAuthDialog();
	const router = useRouter();
	const userId = session?.user?.id ?? null;
	const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	useEffect(() => {
		if (!userId) {
			setSavedIds(new Set());
			return;
		}
		let cancelled = false;
		fetch("/api/account/bookmarks")
			.then((response) => (response.ok ? response.json() : null))
			.then((body: { listingIds?: string[] } | null) => {
				if (!cancelled && body?.listingIds) {
					setSavedIds(new Set(body.listingIds));
				}
			})
			.catch(() => {
				// Saved state is a progressive enhancement; leave buttons unsaved.
			});
		return () => {
			cancelled = true;
		};
	}, [userId]);

	const isSaved = useCallback(
		(listingId: string) => savedIds.has(listingId),
		[savedIds],
	);

	const toggle = useCallback(
		(listingId: string) => {
			if (!userId) {
				openAuth({ view: "login" });
				return;
			}
			const saved = !savedIds.has(listingId);
			setSavedIds((previous) => {
				const next = new Set(previous);
				if (saved) {
					next.add(listingId);
				} else {
					next.delete(listingId);
				}
				return next;
			});
			fetch("/api/account/bookmarks", {
				body: JSON.stringify({ listingId, saved }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			})
				.then((response) => {
					if (!response.ok) {
						throw new Error(`Bookmark toggle failed (${response.status})`);
					}
					router.refresh();
				})
				.catch(() => {
					// Roll back the optimistic flip so the UI matches the server.
					setSavedIds((previous) => {
						const next = new Set(previous);
						if (saved) {
							next.delete(listingId);
						} else {
							next.add(listingId);
						}
						return next;
					});
				});
		},
		[userId, savedIds, openAuth, router],
	);

	const value = useMemo(() => ({ isSaved, toggle }), [isSaved, toggle]);

	return (
		<SavedListingsContext.Provider value={value}>
			{children}
		</SavedListingsContext.Provider>
	);
}

export function useSavedListings(): SavedListingsContextValue {
	const context = useContext(SavedListingsContext);
	if (!context) {
		throw new Error(
			"useSavedListings must be used within a SavedListingsProvider",
		);
	}
	return context;
}
