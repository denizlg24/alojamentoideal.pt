import type {
	BokunActivityAvailability,
	BokunActivityDetail,
	BokunActivityPricingCategory,
	BokunAgendaItem,
	BokunGuidance,
	BokunPhoto,
	BokunRatePrices,
	BokunStartTime,
} from "../integrations/bokun";
import type {
	ActivityAgendaItem,
	ActivityAvailabilityCalendar,
	ActivityDeparture,
	ActivityDepartureRate,
	ActivityDetail,
	ActivityDifficulty,
	ActivityDuration,
	ActivityDurationBucket,
	ActivityGuidance,
	ActivityLocation,
	ActivityMoney,
	ActivityPhoto,
	ActivityPriceTier,
	ActivityPricingCategory,
	ActivitySummary,
} from "./types";

const DIFFICULTY_BY_BOKUN: Record<string, ActivityDifficulty> = {
	VERY_EASY: "very_easy",
	EASY: "easy",
	MODERATE: "moderate",
	CHALLENGING: "challenging",
	DEMANDING: "demanding",
	EXTREME: "extreme",
};

const MINUTES_PER = {
	minutes: 1,
	hours: 60,
	days: 60 * 24,
	weeks: 60 * 24 * 7,
} as const;

function normalizeDifficulty(
	value: string | null | undefined,
): ActivityDifficulty | null {
	if (!value) return null;
	return DIFFICULTY_BY_BOKUN[value.toUpperCase()] ?? null;
}

/** Turns a Bokun enum token (e.g. `WALKING_TOUR`) into a display label. */
export function humanizeToken(value: string): string {
	const lower = value.replaceAll("_", " ").trim().toLowerCase();
	return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function totalDurationMinutes(raw: {
	durationMinutes?: number | null;
	durationHours?: number | null;
	durationDays?: number | null;
	durationWeeks?: number | null;
}): number | null {
	const parts = [
		(raw.durationMinutes ?? 0) * MINUTES_PER.minutes,
		(raw.durationHours ?? 0) * MINUTES_PER.hours,
		(raw.durationDays ?? 0) * MINUTES_PER.days,
		(raw.durationWeeks ?? 0) * MINUTES_PER.weeks,
	];
	const total = parts.reduce((sum, part) => sum + part, 0);
	return total > 0 ? total : null;
}

function durationBucket(
	totalMinutes: number | null,
	days: number | null | undefined,
	weeks: number | null | undefined,
): ActivityDurationBucket | null {
	if ((days ?? 0) >= 1 || (weeks ?? 0) >= 1) return "multi_day";
	if (totalMinutes === null) return null;
	if (totalMinutes < 120) return "short";
	if (totalMinutes <= 300) return "half_day";
	return "full_day";
}

function mapDuration(raw: BokunActivityDetail): ActivityDuration {
	const totalMinutes = totalDurationMinutes(raw);
	return {
		totalMinutes,
		text: raw.durationText ?? null,
		bucket: durationBucket(totalMinutes, raw.durationDays, raw.durationWeeks),
	};
}

function mapPhoto(photo: BokunPhoto | null | undefined): ActivityPhoto | null {
	if (!photo) return null;
	const derivedUrls = (photo.derived ?? [])
		.map((entry) => entry.url)
		.filter((url): url is string => Boolean(url));
	const url = photo.originalUrl ?? derivedUrls[0] ?? null;
	if (!url) return null;
	return {
		url,
		thumbnailUrl: derivedUrls[0] ?? null,
		alt: photo.alternateText ?? photo.description ?? null,
	};
}

function mapPhotos(
	photos: (BokunPhoto | null | undefined)[] | null | undefined,
): ActivityPhoto[] {
	if (!photos) return [];
	return photos
		.map(mapPhoto)
		.filter((photo): photo is ActivityPhoto => photo !== null);
}

function mapLocation(raw: BokunActivityDetail): ActivityLocation | null {
	const place = raw.googlePlace;
	if (!place) return null;
	const center = place.geoLocationCenter ?? null;
	const location: ActivityLocation = {
		city: place.city ?? null,
		country: place.country ?? null,
		latitude: center?.lat ?? null,
		longitude: center?.lng ?? null,
	};
	if (
		location.city === null &&
		location.country === null &&
		location.latitude === null &&
		location.longitude === null
	) {
		return null;
	}
	return location;
}

function mapFromPrice(
	raw: BokunActivityDetail,
	fallbackCurrency: string,
): ActivityMoney | null {
	const money = raw.nextDefaultPriceMoney;
	if (money?.amount != null) {
		return {
			amount: money.amount,
			currency: money.currency ?? fallbackCurrency,
		};
	}
	if (raw.nextDefaultPrice != null) {
		return { amount: raw.nextDefaultPrice, currency: fallbackCurrency };
	}
	return null;
}

function mapPricingCategory(
	raw: BokunActivityPricingCategory,
): ActivityPricingCategory {
	const title = raw.title ?? raw.fullTitle ?? "Participant";
	return {
		id: String(raw.id),
		title,
		fullTitle: raw.fullTitle ?? null,
		minAge: raw.minAge ?? null,
		maxAge: raw.maxAge ?? null,
		occupancy: raw.occupancy ?? 1,
		isDefault: raw.defaultCategory ?? false,
	};
}

function mapGuidance(raw: BokunGuidance): ActivityGuidance {
	return {
		type: raw.guidanceType ?? null,
		languages: raw.languages ?? [],
	};
}

function mapAgendaItem(raw: BokunAgendaItem): ActivityAgendaItem {
	return {
		title: raw.title ?? null,
		body: raw.body ?? raw.excerpt ?? null,
		day: raw.day ?? null,
	};
}

/**
 * Normalizes Bokun language tokens (`EN_GB`, `en`, `PT`) to BCP 47 (`en-GB`).
 * Non-code values (e.g. already-translated names) pass through unchanged.
 */
export function normalizeLanguageCode(value: string): string {
	const match = /^([A-Za-z]{2,3})(?:[_-]([A-Za-z]{2,4}))?$/.exec(value.trim());
	if (!match) return value.trim();
	const base = (match[1] as string).toLowerCase();
	return match[2] ? `${base}-${match[2].toUpperCase()}` : base;
}

/**
 * The languages a guest can actually take the tour in. Guidance types carry the
 * offered guide/audio languages; the top-level `languages` field is only the
 * content translation locale (e.g. `EN_GB`), so it is a fallback, not a merge.
 * De-duplicated by base language so `EN_GB` + `en` collapse to one entry.
 */
function collectLanguages(raw: BokunActivityDetail): string[] {
	const byBase = new Map<string, string>();
	const add = (value: string) => {
		const code = normalizeLanguageCode(value);
		const base = code.split("-")[0] as string;
		if (!byBase.has(base.toLowerCase())) byBase.set(base.toLowerCase(), code);
	};
	for (const guidance of raw.guidanceTypes ?? []) {
		for (const lang of guidance.languages ?? []) add(lang);
	}
	if (byBase.size === 0) {
		for (const lang of raw.languages ?? []) add(lang);
	}
	return [...byBase.values()];
}

export function toActivitySummary(
	raw: BokunActivityDetail,
	options: { currency: string },
): ActivitySummary | null {
	if (raw.id === undefined) return null;
	const photos = mapPhotos(raw.photos);
	return {
		id: String(raw.id),
		slug: raw.slug ?? null,
		title: raw.title ?? "Untitled activity",
		excerpt: raw.excerpt ?? null,
		coverPhoto: photos[0] ?? mapPhoto(raw.keyPhoto) ?? null,
		location: mapLocation(raw),
		difficulty: normalizeDifficulty(raw.difficultyLevel),
		duration: mapDuration(raw),
		categories: (raw.activityCategories ?? []).map(humanizeToken),
		fromPrice: mapFromPrice(raw, options.currency),
		...mapReviews(raw),
	};
}

/**
 * Bokun returns `reviewRating: 0` / `reviewCount: 0` when a vendor has no
 * synced reviews, which must render as "no rating" rather than a literal 0.0.
 */
function mapReviews(raw: BokunActivityDetail): {
	rating: number | null;
	reviewCount: number | null;
} {
	const reviewCount = raw.reviewCount ?? 0;
	if (reviewCount <= 0 || raw.reviewRating == null || raw.reviewRating <= 0) {
		return { rating: null, reviewCount: null };
	}
	return { rating: raw.reviewRating, reviewCount };
}

export function toActivityDetail(
	raw: BokunActivityDetail,
	options: { currency: string },
): ActivityDetail | null {
	const summary = toActivitySummary(raw, options);
	if (summary === null) return null;
	const pricingCategories = (raw.pricingCategories ?? []).map(
		mapPricingCategory,
	);
	return {
		...summary,
		description: raw.description ?? null,
		photos: mapPhotos(raw.photos?.length ? raw.photos : [raw.keyPhoto]),
		languages: collectLanguages(raw),
		guidance: (raw.guidanceTypes ?? []).map(mapGuidance),
		minAge: raw.minAge ?? null,
		meetingType: raw.meetingType ?? null,
		pricingCategories,
		included: raw.included ?? null,
		excluded: raw.excluded ?? null,
		requirements: raw.requirements ?? null,
		attention: raw.attention ?? null,
		agenda: (raw.agendaItems ?? []).map(mapAgendaItem),
		attributes: (raw.activityAttributes ?? []).map(humanizeToken),
	};
}

/**
 * The availability id is `${startTimeId}_${yyyymmdd}`; parse the date from it
 * rather than the epoch `date` field so we sidestep timezone drift.
 */
function departureDate(raw: BokunActivityAvailability): string | null {
	if (raw.id) {
		const parts = raw.id.split("_");
		const stamp = parts[parts.length - 1];
		if (stamp && /^\d{8}$/.test(stamp)) {
			return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
		}
	}
	if (raw.date != null) {
		const millis = raw.date > 1e12 ? raw.date : raw.date * 1000;
		const iso = new Date(millis).toISOString();
		return iso.slice(0, 10);
	}
	return null;
}

/**
 * Joins an availability's `rates` with its `pricesByRate` (on rate id) and
 * groups the tiered category prices per pricing category.
 */
function mapDepartureRates(
	raw: BokunActivityAvailability,
): ActivityDepartureRate[] {
	const pricesByRateId = new Map<string, BokunRatePrices>();
	for (const entry of raw.pricesByRate ?? []) {
		if (entry.activityRateId != null) {
			pricesByRateId.set(String(entry.activityRateId), entry);
		}
	}

	const rates: ActivityDepartureRate[] = [];
	for (const rate of raw.rates ?? []) {
		if (rate.id == null) continue;
		const id = String(rate.id);
		const prices = pricesByRateId.get(id);

		const tiersByCategory: Record<string, ActivityPriceTier[]> = {};
		for (const unit of prices?.pricePerCategoryUnit ?? []) {
			const amount = unit.amount?.amount;
			if (amount == null) continue;
			const categoryId = String(unit.id);
			const tiers = tiersByCategory[categoryId] ?? [];
			tiers.push({
				amount,
				minParticipants: unit.minParticipantsRequired ?? 1,
				maxParticipants: unit.maxParticipantsRequired ?? null,
			});
			tiersByCategory[categoryId] = tiers;
		}
		for (const tiers of Object.values(tiersByCategory)) {
			tiers.sort((a, b) => a.minParticipants - b.minParticipants);
		}

		rates.push({
			id,
			title: rate.title ?? null,
			pricedPerPerson: rate.pricedPerPerson ?? true,
			minPerBooking: rate.minPerBooking ?? 1,
			maxPerBooking: rate.maxPerBooking ?? null,
			pricingCategoryIds: rate.allPricingCategories
				? []
				: (rate.pricingCategoryIds ?? []).map(String),
			pricePerBooking: prices?.pricePerBooking?.amount ?? null,
			tiersByCategory,
		});
	}
	return rates;
}

function toDeparture(raw: BokunActivityAvailability): ActivityDeparture | null {
	const date = departureDate(raw);
	if (date === null) return null;
	const startTimeId = raw.startTimeId != null ? String(raw.startTimeId) : null;
	const id = raw.id ?? `${startTimeId ?? "any"}_${date.replaceAll("-", "")}`;
	const availabilityCount = raw.unlimitedAvailability
		? null
		: (raw.availabilityCount ?? null);
	return {
		id,
		date,
		startTime:
			raw.startTime && raw.startTime !== "00:00" ? raw.startTime : null,
		startTimeId,
		startTimeLabel: raw.startTimeLabel ?? null,
		availabilityCount,
		minParticipants: raw.minParticipantsToBookNow ?? raw.minParticipants ?? 1,
		soldOut:
			(raw.soldOut ?? false) ||
			(raw.unavailable ?? false) ||
			(availabilityCount !== null && availabilityCount <= 0),
		rates: mapDepartureRates(raw),
		defaultRateId: raw.defaultRateId != null ? String(raw.defaultRateId) : null,
	};
}

export function toAvailabilityCalendar(
	raw: BokunActivityAvailability[],
	options: { currency: string; includeSoldOut?: boolean },
): ActivityAvailabilityCalendar {
	const departuresByDate: Record<string, ActivityDeparture[]> = {};
	for (const entry of raw) {
		const departure = toDeparture(entry);
		if (departure === null) continue;
		if (!options.includeSoldOut && departure.soldOut) continue;
		const existing = departuresByDate[departure.date] ?? [];
		existing.push(departure);
		departuresByDate[departure.date] = existing;
	}
	for (const departures of Object.values(departuresByDate)) {
		departures.sort((a, b) =>
			(a.startTime ?? "").localeCompare(b.startTime ?? ""),
		);
	}
	return { currency: options.currency, departuresByDate };
}

/** Formats a Bokun `StartTimeDto` (hour/minute) as `HH:mm`. */
export function formatStartTime(startTime: BokunStartTime): string | null {
	if (startTime.hour == null) return startTime.label ?? null;
	const hh = String(startTime.hour).padStart(2, "0");
	const mm = String(startTime.minute ?? 0).padStart(2, "0");
	return `${hh}:${mm}`;
}
