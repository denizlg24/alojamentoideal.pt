import {
	type ActivityDuration,
	type ActivityMoney,
	normalizeLanguageCode,
} from "@workspace/core/activities";
import { formatListingMoney } from "@/lib/catalog/pricing-display";

const HTML_ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&apos;": "'",
	"&nbsp;": " ",
};

function decodeEntities(value: string): string {
	return value
		.replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 16)),
		)
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 10)),
		)
		.replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITIES[entity] ?? entity);
}

/**
 * Bokun descriptions are operator-authored HTML. Rather than pull in a
 * sanitizer to render arbitrary markup, we downgrade block boundaries to line
 * breaks, strip remaining tags, and return clean text blocks the UI renders as
 * paragraphs. Safe by construction (no HTML reaches the DOM).
 */
export function formatActivityHtml(html: string | null): string[] {
	if (!html) return [];
	const withBreaks = html
		.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
		.replace(/<\s*li[^>]*>/gi, "\n• ")
		.replace(/<[^>]+>/g, "");
	return decodeEntities(withBreaks)
		.split(/\n+/)
		.map((block) => block.replace(/[ \t]+/g, " ").trim())
		.filter((block) => block.length > 0);
}

/** Human duration, preferring Bokun's localized `durationText`. */
export function formatDuration(duration: ActivityDuration): string | null {
	if (duration.text) return duration.text;
	const total = duration.totalMinutes;
	if (total === null) return null;

	const days = Math.floor(total / (60 * 24));
	const hours = Math.floor((total % (60 * 24)) / 60);
	const minutes = total % 60;
	const parts: string[] = [];
	if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	return parts.length > 0 ? parts.join(" ") : null;
}

export function formatActivityMoney(
	money: ActivityMoney | null,
): string | null {
	if (!money) return null;
	return formatListingMoney(money.amount, money.currency);
}

const LANGUAGE_NAMES =
	typeof Intl !== "undefined" && "DisplayNames" in Intl
		? new Intl.DisplayNames(["en"], { type: "language" })
		: null;

/**
 * Turns a Bokun language token (`en`, `EN_GB`, `pt-PT`) into an English name.
 * Bokun mixes casings and underscore separators, so normalize before lookup;
 * anything that is not a code (already a name) falls through unchanged.
 */
export function formatLanguage(code: string): string {
	const normalized = normalizeLanguageCode(code);
	if (LANGUAGE_NAMES && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(normalized)) {
		try {
			return LANGUAGE_NAMES.of(normalized) ?? normalized;
		} catch {
			return normalized;
		}
	}
	return code.trim();
}

const MEETING_TYPE_LABELS: Record<string, string> = {
	MEET_ON_LOCATION: "Meet on location",
	PICK_UP: "Hotel pickup included",
	MEET_ON_LOCATION_OR_PICK_UP: "Meet on location or pickup",
};

export function formatMeetingType(meetingType: string | null): string | null {
	if (!meetingType) return null;
	return MEETING_TYPE_LABELS[meetingType] ?? null;
}
