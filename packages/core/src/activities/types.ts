/**
 * Domain model for Bokun activities/tours.
 *
 * These types are the strict, UI-facing shape the web app renders. They are
 * produced by the mappers in `./mappers` from the permissive Bokun adapter
 * DTOs, so all provider drift and optionality is resolved here once.
 */

export type ActivityDifficulty =
	| "very_easy"
	| "easy"
	| "moderate"
	| "challenging"
	| "demanding"
	| "extreme";

/**
 * Coarse duration bands used for the list-page duration filter. Same-day bands
 * split on total minutes; anything spanning a day or more is `multi_day`.
 */
export type ActivityDurationBucket =
	| "short"
	| "half_day"
	| "full_day"
	| "multi_day";

export interface ActivityDuration {
	totalMinutes: number | null;
	text: string | null;
	bucket: ActivityDurationBucket | null;
}

export interface ActivityPhoto {
	url: string;
	thumbnailUrl: string | null;
	alt: string | null;
}

export interface ActivityLocation {
	city: string | null;
	country: string | null;
	latitude: number | null;
	longitude: number | null;
}

export interface ActivityMoney {
	amount: number;
	currency: string;
}

export interface ActivityPricingCategory {
	id: string;
	title: string;
	fullTitle: string | null;
	minAge: number | null;
	maxAge: number | null;
	/** Seats an availability loses per ticket sold in this category (usually 1). */
	occupancy: number;
	isDefault: boolean;
}

export interface ActivityGuidance {
	type: string | null;
	languages: string[];
}

export interface ActivityAgendaItem {
	title: string | null;
	body: string | null;
	day: number | null;
}

export interface ActivitySummary {
	id: string;
	slug: string | null;
	title: string;
	excerpt: string | null;
	coverPhoto: ActivityPhoto | null;
	location: ActivityLocation | null;
	difficulty: ActivityDifficulty | null;
	duration: ActivityDuration;
	categories: string[];
	fromPrice: ActivityMoney | null;
	rating: number | null;
	reviewCount: number | null;
}

export interface ActivityDetail extends ActivitySummary {
	description: string | null;
	photos: ActivityPhoto[];
	languages: string[];
	guidance: ActivityGuidance[];
	minAge: number | null;
	meetingType: string | null;
	pricingCategories: ActivityPricingCategory[];
	included: string | null;
	excluded: string | null;
	requirements: string | null;
	attention: string | null;
	agenda: ActivityAgendaItem[];
	attributes: string[];
}

/**
 * One group-size price tier: the per-unit price that applies when the booked
 * count for the category falls inside `[minParticipants, maxParticipants]`.
 */
export interface ActivityPriceTier {
	amount: number;
	minParticipants: number;
	/** null = no upper bound. */
	maxParticipants: number | null;
}

/** A bookable rate on a departure, with its per-category tiered prices. */
export interface ActivityDepartureRate {
	id: string;
	title: string | null;
	pricedPerPerson: boolean;
	minPerBooking: number;
	maxPerBooking: number | null;
	/** Pricing categories this rate sells; empty = all. */
	pricingCategoryIds: string[];
	/** Flat price per booking, for rates not priced per person. */
	pricePerBooking: number | null;
	/** pricingCategoryId -> tiers ordered by minParticipants. */
	tiersByCategory: Record<string, ActivityPriceTier[]>;
}

/** One departure: a start time on a specific date, with live pricing/seats. */
export interface ActivityDeparture {
	/** Bokun availability id, `${startTimeId}_${yyyymmdd}`. */
	id: string;
	/** ISO `yyyy-MM-dd`. */
	date: string;
	/** `HH:mm`, or null for date-only (pass/day) products. */
	startTime: string | null;
	startTimeId: string | null;
	startTimeLabel: string | null;
	/** Open seats; null when the product has unlimited availability. */
	availabilityCount: number | null;
	minParticipants: number;
	soldOut: boolean;
	rates: ActivityDepartureRate[];
	defaultRateId: string | null;
}

export interface ActivityAvailabilityCalendar {
	currency: string;
	/** ISO `yyyy-MM-dd` -> departures on that date, ordered by start time. */
	departuresByDate: Record<string, ActivityDeparture[]>;
}

/** categoryId -> participant count. */
export type ActivityParticipantSelection = Record<string, number>;
