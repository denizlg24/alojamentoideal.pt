import {
	type ActivityDeparture,
	type ActivityDepartureRate,
	computeRateTotal,
	defaultRate,
	rateUnitPrice,
	toAvailabilityCalendar,
	totalParticipants,
	validateDepartureSelection,
} from "@workspace/core/activities";
import {
	ACTIVITY_PROVIDER,
	type ActivityCacheConfig,
	getActivityCacheConfigFromSettings,
} from "@workspace/core/activities/cache";
import {
	type ActivityQuoteResult,
	type CommerceActivityQuoteInput,
	CommerceError,
	toMinorUnits,
} from "@workspace/core/commerce";
import { createBokunClientFromEnv } from "@workspace/core/integrations/bokun";
import { logger } from "@workspace/core/observability";
import { getCachedActivityDetail } from "./source";

function selectionFromInput(
	input: CommerceActivityQuoteInput,
): Record<string, number> {
	const selection: Record<string, number> = {};
	for (const participant of input.participants) {
		selection[String(participant.pricingCategoryId)] =
			(selection[String(participant.pricingCategoryId)] ?? 0) +
			participant.count;
	}
	return selection;
}

function findDeparture(
	departures: ActivityDeparture[],
	startTimeId: string | null | undefined,
): ActivityDeparture | null {
	if (startTimeId) {
		return (
			departures.find((departure) => departure.startTimeId === startTimeId) ??
			null
		);
	}
	return (
		departures.find((departure) => !departure.soldOut) ?? departures[0] ?? null
	);
}

function findRate(
	departure: ActivityDeparture,
	rateId: string | null | undefined,
): ActivityDepartureRate | null {
	if (rateId) {
		return departure.rates.find((rate) => rate.id === rateId) ?? null;
	}
	return defaultRate(departure);
}

function unavailableQuote(
	input: CommerceActivityQuoteInput,
	config: ActivityCacheConfig,
): ActivityQuoteResult {
	const totalSelected = Math.max(
		totalParticipants(selectionFromInput(input)),
		1,
	);
	return {
		activityDate: input.activityDate,
		answers: input.answers,
		available: false,
		bokunActivityId: input.activityId,
		currency: config.currency,
		fetchedAt: new Date(),
		participants: input.participants.map((participant) => ({
			count: participant.count,
			label: String(participant.pricingCategoryId),
			pricingCategoryId: participant.pricingCategoryId,
			subtotalMinor: 0,
			unitPriceMinor: 0,
		})),
		providerPayload: { provider: ACTIVITY_PROVIDER, reason: "unavailable" },
		rateId: input.rateId ?? null,
		startTimeId: input.startTimeId ?? null,
		subtotalMinor: 0,
		taxMinor: 0,
		totalMinor: 0,
		totalParticipants: totalSelected,
	};
}

export async function quoteBokunActivity(
	input: CommerceActivityQuoteInput,
	config?: ActivityCacheConfig,
): Promise<ActivityQuoteResult> {
	const resolvedConfig = config ?? (await getActivityCacheConfigFromSettings());
	if (!resolvedConfig.activityIds.includes(input.activityId)) {
		throw new CommerceError(
			"activity_unavailable",
			"This activity is not available for online booking.",
			404,
		);
	}

	const detail = await getCachedActivityDetail(input.activityId, {
		accountId: resolvedConfig.accountId,
		provider: ACTIVITY_PROVIDER,
	});
	if (!detail) {
		throw new CommerceError(
			"activity_unavailable",
			"This activity is not available for online booking.",
			404,
		);
	}

	try {
		const raw = await createBokunClientFromEnv().v1.activity.getAvailabilities(
			input.activityId,
			{
				currency: resolvedConfig.currency,
				end: input.activityDate,
				includeSoldOut: true,
				lang: resolvedConfig.lang,
				start: input.activityDate,
			},
		);
		const calendar = toAvailabilityCalendar(raw, {
			currency: resolvedConfig.currency,
			includeSoldOut: true,
		});
		const departure = findDeparture(
			calendar.departuresByDate[input.activityDate] ?? [],
			input.startTimeId,
		);
		if (!departure) {
			return unavailableQuote(input, resolvedConfig);
		}

		const rate = findRate(departure, input.rateId);
		if (!rate) {
			return unavailableQuote(input, resolvedConfig);
		}

		const selection = selectionFromInput(input);
		const issue = validateDepartureSelection(
			departure,
			selection,
			detail.pricingCategories,
			rate,
		);
		const total = issue ? null : computeRateTotal(rate, selection);
		if (issue || total === null) {
			return unavailableQuote(input, resolvedConfig);
		}

		const participants = input.participants.map((participant) => {
			const categoryId = String(participant.pricingCategoryId);
			const category = detail.pricingCategories.find(
				(entry) => entry.id === categoryId,
			);
			const unit = rateUnitPrice(rate, categoryId, participant.count) ?? 0;
			const subtotal = rate.pricedPerPerson ? unit * participant.count : unit;
			return {
				count: participant.count,
				label: category?.title ?? categoryId,
				pricingCategoryId: participant.pricingCategoryId,
				subtotalMinor: toMinorUnits(subtotal, resolvedConfig.currency),
				unitPriceMinor: toMinorUnits(unit, resolvedConfig.currency),
			};
		});

		const totalMinor = toMinorUnits(total, resolvedConfig.currency);
		return {
			activityDate: input.activityDate,
			answers: input.answers,
			available: true,
			bokunActivityId: input.activityId,
			currency: resolvedConfig.currency,
			fetchedAt: new Date(),
			participants,
			providerPayload: {
				availabilityId: departure.id,
				provider: ACTIVITY_PROVIDER,
				rateId: rate.id,
				startTimeId: departure.startTimeId,
			},
			rateId: rate.id,
			startTimeId: departure.startTimeId,
			subtotalMinor: totalMinor,
			taxMinor: 0,
			totalMinor,
			totalParticipants: totalParticipants(selection),
		};
	} catch (error) {
		logger.warn("failed to quote Bokun activity", {
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
