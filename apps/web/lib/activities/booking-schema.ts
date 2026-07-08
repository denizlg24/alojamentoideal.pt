import {
	type ActivityBookingSchema,
	normalizeActivityBookingSchema,
} from "@workspace/core/activities";
import {
	type ActivityCacheConfig,
	getActivityCacheConfigFromSettings,
} from "@workspace/core/activities/cache";
import { CommerceError } from "@workspace/core/commerce";
import { createBokunClientFromEnv } from "@workspace/core/integrations/bokun";
import { logger } from "@workspace/core/observability";

export interface ActivityBookingSchemaInput {
	activityDate: string;
	activityId: string;
	participants: { count: number; pricingCategoryId: number }[];
	rateId: string | null;
	startTimeId: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function firstPlaceId(places: unknown, key: string): number | undefined {
	const container = record(places);
	const list = container?.[key];
	const first = Array.isArray(list) ? record(list[0]) : null;
	const id = first?.id;
	return typeof id === "number"
		? id
		: typeof id === "string" && /^\d+$/.test(id)
			? Number(id)
			: undefined;
}

function rateSelectionTypes(
	detail: unknown,
	rateId: string | null,
): { dropoff: string | null; pickup: string | null } {
	const rates = record(detail)?.rates;
	if (!Array.isArray(rates)) {
		return { dropoff: null, pickup: null };
	}
	const match =
		rates
			.map(record)
			.find((rate) => rate !== null && String(rate.id) === rateId) ??
		record(rates[0]);
	return {
		dropoff:
			typeof match?.dropoffSelectionType === "string"
				? match.dropoffSelectionType
				: null,
		pickup:
			typeof match?.pickupSelectionType === "string"
				? match.pickupSelectionType
				: null,
	};
}

/**
 * Fetches the live Bokun booking-question schema for one activity selection and
 * normalizes it for the checkout UI. Mirrors {@link quoteBokunActivity}: three
 * provider reads (pickup places + activity detail in parallel, then the checkout
 * options seeded with a valid place) folded into a pure normalizer.
 */
export async function resolveActivityBookingSchema(
	input: ActivityBookingSchemaInput,
	config?: ActivityCacheConfig,
): Promise<ActivityBookingSchema> {
	const resolvedConfig = config ?? (await getActivityCacheConfigFromSettings());
	const client = createBokunClientFromEnv();

	const passengers = input.participants.flatMap((participant) =>
		Array.from({ length: Math.max(0, participant.count) }, () => ({
			pricingCategoryId: participant.pricingCategoryId,
		})),
	);
	if (passengers.length === 0) {
		throw new CommerceError(
			"invalid_request",
			"Select at least one participant.",
			400,
		);
	}

	try {
		const [pickupPlaces, detail] = await Promise.all([
			client.v1.activity.getPickupPlaces(input.activityId, {
				lang: resolvedConfig.lang,
			}),
			client.v1.activity.get(input.activityId, {
				currency: resolvedConfig.currency,
				lang: resolvedConfig.lang,
			}),
		]);

		const pickupPlaceId = firstPlaceId(pickupPlaces, "pickupPlaces");
		const dropoffPlaceId = firstPlaceId(pickupPlaces, "dropoffPlaces");

		const options = await client.v1.checkout.optionsForBookingRequest({
			activityBookings: [
				{
					activityId: Number(input.activityId),
					date: input.activityDate,
					passengers,
					...(dropoffPlaceId !== undefined ? { dropoffPlaceId } : {}),
					...(pickupPlaceId !== undefined ? { pickupPlaceId } : {}),
					...(input.rateId ? { rateId: Number(input.rateId) } : {}),
					...(input.startTimeId
						? { startTimeId: Number(input.startTimeId) }
						: {}),
				},
			],
		});

		const selection = rateSelectionTypes(detail, input.rateId);
		return normalizeActivityBookingSchema({
			activityId: input.activityId,
			dropoffPlaces: pickupPlaces,
			dropoffSelectionType: selection.dropoff,
			options,
			pickupPlaces,
			pickupSelectionType: selection.pickup,
		});
	} catch (error) {
		logger.warn("failed to resolve Bokun booking schema", {
			activityId: input.activityId,
			error,
		});
		throw new CommerceError(
			"activity_booking_unavailable",
			"Activity booking is not available right now.",
			503,
		);
	}
}
