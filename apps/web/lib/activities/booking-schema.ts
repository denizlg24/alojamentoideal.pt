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
	dropoffPlaceId?: string | null;
	participants: { count: number; pricingCategoryId: number }[];
	pickupPlaceId?: string | null;
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

function numericPlaceId(value: string | null | undefined): number | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}
	const trimmed = value.trim();
	return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

function optionPlaceId(
	selectedPlaceId: string | null | undefined,
	places: unknown,
	key: string,
	selectionType: string | null,
): number | undefined {
	const selected = numericPlaceId(selectedPlaceId);
	if (selected !== undefined) {
		return selected;
	}
	const selection = selectionType?.trim().toUpperCase();
	if (selection === "OPTIONAL" || selection === "NOT_INCLUDED") {
		return undefined;
	}
	return firstPlaceId(places, key);
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

function buildShoppingCartActivityRequest(
	input: ActivityBookingSchemaInput,
	pricingCategoryBookings: { pricingCategoryId: number }[],
	pickupPlaceId: number | undefined,
	dropoffPlaceId: number | undefined,
): Record<string, unknown> {
	return {
		activityId: Number(input.activityId),
		date: input.activityDate,
		dropoff: dropoffPlaceId !== undefined,
		pickup: pickupPlaceId !== undefined,
		pricingCategoryBookings,
		...(dropoffPlaceId !== undefined ? { dropoffPlaceId } : {}),
		...(pickupPlaceId !== undefined ? { pickupPlaceId } : {}),
		...(input.rateId ? { rateId: Number(input.rateId) } : {}),
		...(input.startTimeId ? { startTimeId: Number(input.startTimeId) } : {}),
	};
}

/**
 * Fetches the live Bokun booking-question schema for one activity selection and
 * normalizes it for the checkout UI. Bokun only expands system pickup/dropoff
 * questions, such as room and flight details, from a shopping-cart checkout
 * options response, so this mirrors the legacy flow instead of using the direct
 * booking-request options endpoint.
 */
export async function resolveActivityBookingSchema(
	input: ActivityBookingSchemaInput,
	config?: ActivityCacheConfig,
): Promise<ActivityBookingSchema> {
	const resolvedConfig = config ?? (await getActivityCacheConfigFromSettings());
	const client = createBokunClientFromEnv();

	const pricingCategoryBookings = input.participants.flatMap((participant) =>
		Array.from({ length: Math.max(0, participant.count) }, () => ({
			pricingCategoryId: participant.pricingCategoryId,
		})),
	);
	if (pricingCategoryBookings.length === 0) {
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

		const selection = rateSelectionTypes(detail, input.rateId);
		const pickupPlaceId = optionPlaceId(
			input.pickupPlaceId,
			pickupPlaces,
			"pickupPlaces",
			selection.pickup,
		);
		const dropoffPlaceId = optionPlaceId(
			input.dropoffPlaceId,
			pickupPlaces,
			"dropoffPlaces",
			selection.dropoff,
		);

		const sessionId = `activity-schema-${crypto.randomUUID()}`;
		await client.v1.shoppingCart.addActivity(
			sessionId,
			buildShoppingCartActivityRequest(
				input,
				pricingCategoryBookings,
				pickupPlaceId,
				dropoffPlaceId,
			),
			{ currency: resolvedConfig.currency, lang: resolvedConfig.lang },
		);
		const options = await client.v1.checkout.optionsForShoppingCart(sessionId);

		return normalizeActivityBookingSchema({
			activityId: input.activityId,
			customPickupAllowed: record(detail)?.customPickupAllowed === true,
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
