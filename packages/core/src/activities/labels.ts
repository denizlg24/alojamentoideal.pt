import type { ActivityDifficulty, ActivityDurationBucket } from "./types";

export const DIFFICULTY_LABELS: Record<ActivityDifficulty, string> = {
	very_easy: "Very easy",
	easy: "Easy",
	moderate: "Moderate",
	challenging: "Challenging",
	demanding: "Demanding",
	extreme: "Extreme",
};

/** Ordered from gentlest to hardest, for filter rows and sorting. */
export const DIFFICULTY_ORDER: ActivityDifficulty[] = [
	"very_easy",
	"easy",
	"moderate",
	"challenging",
	"demanding",
	"extreme",
];

export const DURATION_BUCKET_LABELS: Record<ActivityDurationBucket, string> = {
	short: "Under 2 hours",
	half_day: "Half day",
	full_day: "Full day",
	multi_day: "Multi-day",
};

export const DURATION_BUCKET_ORDER: ActivityDurationBucket[] = [
	"short",
	"half_day",
	"full_day",
	"multi_day",
];

export function difficultyLabel(value: ActivityDifficulty): string {
	return DIFFICULTY_LABELS[value];
}

export function durationBucketLabel(value: ActivityDurationBucket): string {
	return DURATION_BUCKET_LABELS[value];
}
