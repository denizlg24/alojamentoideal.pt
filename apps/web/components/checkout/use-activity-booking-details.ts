"use client";

import type { ActivityBookingSchema } from "@workspace/core/activities";
import type {
	ActivityCartItemDto,
	CartDto,
	DraftOrderActivityDetailInput,
} from "@workspace/core/commerce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type ActivityBookingDescription,
	type ActivityBookingDraft,
	buildActivityDetailInput,
	describeActivityBooking,
	emptyActivityDraft,
	isActivityDetailComplete,
} from "@/lib/activities/booking-details";
import * as api from "@/lib/checkout/api-client";

export type ActivitySchemaState =
	| { status: "loading" }
	| { status: "error" }
	| {
			status: "ready";
			schema: ActivityBookingSchema;
			description: ActivityBookingDescription;
	  };

export interface ActivityBookingEntry {
	item: ActivityCartItemDto;
	state: ActivitySchemaState;
	draft: ActivityBookingDraft;
}

export interface UseActivityBookingDetails {
	entries: ActivityBookingEntry[];
	hasActivities: boolean;
	/** At least one item requires a guest input, so the card should render. */
	hasQuestions: boolean;
	/** A schema is still loading; submit should wait. */
	loading: boolean;
	/** A schema failed to load; the required questions cannot be collected. */
	hasError: boolean;
	/** Every required field/place across all activity items is supplied. */
	isComplete: boolean;
	setAnswer: (cartItemId: string, key: string, value: string) => void;
	setPickupPlace: (cartItemId: string, placeId: string | null) => void;
	setDropoffPlace: (cartItemId: string, placeId: string | null) => void;
	setRoomNumber: (cartItemId: string, value: string) => void;
	retry: (cartItemId: string) => void;
	/** Draft-order activity details for every ready item (call once complete). */
	buildActivityDetails: () => DraftOrderActivityDetailInput[];
}

function activityItemsOf(cart: CartDto | null): ActivityCartItemDto[] {
	return (cart?.items ?? []).filter(
		(item): item is ActivityCartItemDto =>
			item.status === "active" && item.type === "activity",
	);
}

/** Refetch the schema only when the priced selection actually changes. */
function selectionSignature(item: ActivityCartItemDto): string {
	const parts = item.participants
		.map(
			(participant) => `${participant.pricingCategoryId}x${participant.count}`,
		)
		.sort()
		.join(",");
	return [
		item.activityId,
		item.activityDate,
		item.rateId ?? "",
		item.startTimeId ?? "",
		parts,
	].join("|");
}

/**
 * Loads each activity item's Bokun booking-question schema and holds the guest's
 * answers/pickup selections so checkout can collect exactly the required inputs
 * before freezing the draft order. Schemas load in the background while the guest
 * fills their contact details, so most bookings add no perceptible friction.
 */
export function useActivityBookingDetails(
	cart: CartDto | null,
): UseActivityBookingDetails {
	const activityItems = useMemo(() => activityItemsOf(cart), [cart]);
	const [schemas, setSchemas] = useState<Map<string, ActivitySchemaState>>(
		new Map(),
	);
	const [drafts, setDrafts] = useState<Map<string, ActivityBookingDraft>>(
		new Map(),
	);
	// cartItemId -> selection signature already fetched, so unrelated cart
	// updates (a new object identity every optimistic edit) never refetch.
	const fetchedRef = useRef<Map<string, string>>(new Map());

	useEffect(() => {
		let cancelled = false;
		const seen = new Set<string>();

		for (const item of activityItems) {
			seen.add(item.id);
			const signature = selectionSignature(item);
			if (fetchedRef.current.get(item.id) === signature) {
				continue;
			}
			fetchedRef.current.set(item.id, signature);
			setSchemas((prev) => new Map(prev).set(item.id, { status: "loading" }));
			setDrafts((prev) =>
				prev.has(item.id)
					? prev
					: new Map(prev).set(item.id, emptyActivityDraft()),
			);

			api
				.fetchActivityBookingSchema({
					activityDate: item.activityDate,
					activityId: item.activityId,
					participants: item.participants.map((participant) => ({
						count: participant.count,
						pricingCategoryId: participant.pricingCategoryId,
					})),
					rateId: item.rateId,
					startTimeId: item.startTimeId,
				})
				.then((schema) => {
					if (cancelled || fetchedRef.current.get(item.id) !== signature) {
						return;
					}
					setSchemas((prev) =>
						new Map(prev).set(item.id, {
							description: describeActivityBooking(item, schema),
							schema,
							status: "ready",
						}),
					);
				})
				.catch(() => {
					if (cancelled || fetchedRef.current.get(item.id) !== signature) {
						return;
					}
					setSchemas((prev) => new Map(prev).set(item.id, { status: "error" }));
				});
		}

		const prune = <T>(prev: Map<string, T>): Map<string, T> => {
			let changed = false;
			const next = new Map(prev);
			for (const id of next.keys()) {
				if (!seen.has(id)) {
					next.delete(id);
					changed = true;
				}
			}
			return changed ? next : prev;
		};
		setSchemas(prune);
		setDrafts(prune);
		for (const id of Array.from(fetchedRef.current.keys())) {
			if (!seen.has(id)) {
				fetchedRef.current.delete(id);
			}
		}

		return () => {
			cancelled = true;
		};
	}, [activityItems]);

	const setAnswer = useCallback(
		(cartItemId: string, key: string, value: string) => {
			setDrafts((prev) => {
				const current = prev.get(cartItemId) ?? emptyActivityDraft();
				return new Map(prev).set(cartItemId, {
					...current,
					answers: { ...current.answers, [key]: value },
				});
			});
		},
		[],
	);

	const setPickupPlace = useCallback(
		(cartItemId: string, placeId: string | null) => {
			setDrafts((prev) => {
				const current = prev.get(cartItemId) ?? emptyActivityDraft();
				return new Map(prev).set(cartItemId, {
					...current,
					pickupPlaceId: placeId,
				});
			});
		},
		[],
	);

	const setDropoffPlace = useCallback(
		(cartItemId: string, placeId: string | null) => {
			setDrafts((prev) => {
				const current = prev.get(cartItemId) ?? emptyActivityDraft();
				return new Map(prev).set(cartItemId, {
					...current,
					dropoffPlaceId: placeId,
				});
			});
		},
		[],
	);

	const setRoomNumber = useCallback((cartItemId: string, value: string) => {
		setDrafts((prev) => {
			const current = prev.get(cartItemId) ?? emptyActivityDraft();
			return new Map(prev).set(cartItemId, { ...current, roomNumber: value });
		});
	}, []);

	const retry = useCallback((cartItemId: string) => {
		// Drop the fetched signature so the effect re-requests on its next run.
		fetchedRef.current.delete(cartItemId);
		setSchemas((prev) => new Map(prev).set(cartItemId, { status: "loading" }));
	}, []);

	const entries = useMemo<ActivityBookingEntry[]>(
		() =>
			activityItems.map((item) => ({
				draft: drafts.get(item.id) ?? emptyActivityDraft(),
				item,
				state: schemas.get(item.id) ?? { status: "loading" },
			})),
		[activityItems, drafts, schemas],
	);

	const loading = entries.some((entry) => entry.state.status === "loading");
	const hasError = entries.some((entry) => entry.state.status === "error");
	const hasQuestions = entries.some(
		(entry) =>
			entry.state.status === "ready" && entry.state.description.needsInput,
	);
	const isComplete =
		!loading &&
		!hasError &&
		entries.every(
			(entry) =>
				entry.state.status === "ready" &&
				isActivityDetailComplete(entry.state.description, entry.draft),
		);

	const buildActivityDetails =
		useCallback((): DraftOrderActivityDetailInput[] => {
			const details: DraftOrderActivityDetailInput[] = [];
			for (const entry of entries) {
				if (entry.state.status !== "ready") {
					continue;
				}
				details.push(
					buildActivityDetailInput(
						entry.item.id,
						entry.state.description,
						entry.draft,
					),
				);
			}
			return details;
		}, [entries]);

	return {
		buildActivityDetails,
		entries,
		hasActivities: activityItems.length > 0,
		hasError,
		hasQuestions,
		isComplete,
		loading,
		retry,
		setAnswer,
		setDropoffPlace,
		setPickupPlace,
		setRoomNumber,
	};
}
