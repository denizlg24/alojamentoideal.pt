import { describe, expect, it } from "bun:test";
import {
	HostkitApiError,
	HostkitNetworkError,
	HostkitTimeoutError,
} from "../integrations/hostkit";
import { countryAlpha3 } from "./country-codes";
import {
	GUEST_INFO_REMINDER_MAX_DELAY_MS,
	GUEST_INFO_REMINDER_MIN_DELAY_MS,
	nextGuestInfoReminderDelayMs,
} from "./guest-reminder";
import {
	buildHostkitGuest,
	classifyGuestSubmissionError,
	mapHostkitDocumentType,
	nextGuestSubmissionDelayMs,
} from "./guest-submission";

const STAY = {
	arrival: "2026-07-10",
	departure: "2026-07-15",
	rcode: "HMK71DA91ALK",
};

const COMPLETE_GUEST = {
	dateOfBirth: "1990-12-01",
	documentIssuingCountry: "FR",
	documentNumber: "123456789",
	documentType: "passport",
	firstName: "Alana",
	lastName: "Bolsch",
	nationality: "FR",
	position: 0,
	residenceCountry: "FR",
};

describe("countryAlpha3", () => {
	it("converts alpha-2 to alpha-3", () => {
		expect(countryAlpha3("pt")).toBe("PRT");
		expect(countryAlpha3("FR")).toBe("FRA");
		expect(countryAlpha3("GB")).toBe("GBR");
	});

	it("accepts known alpha-3 codes as-is", () => {
		expect(countryAlpha3("PRT")).toBe("PRT");
	});

	it("returns null for unknown codes", () => {
		expect(countryAlpha3("XX")).toBeNull();
		expect(countryAlpha3("XXX")).toBeNull();
		expect(countryAlpha3(null)).toBeNull();
		expect(countryAlpha3("")).toBeNull();
	});
});

describe("mapHostkitDocumentType", () => {
	it("maps Stripe Identity vocabulary", () => {
		expect(mapHostkitDocumentType("passport")).toBe("P");
		expect(mapHostkitDocumentType("id_card")).toBe("ID");
		expect(mapHostkitDocumentType("driving_license")).toBe("O");
	});

	it("accepts Hostkit codes directly", () => {
		expect(mapHostkitDocumentType("P")).toBe("P");
		expect(mapHostkitDocumentType("id")).toBe("ID");
	});
});

describe("buildHostkitGuest", () => {
	it("builds a complete payload with alpha-3 countries", () => {
		const result = buildHostkitGuest(COMPLETE_GUEST, STAY);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") {
			return;
		}
		expect(result.guest).toEqual({
			arrival: "2026-07-10",
			birthday: "1990-12-01",
			countryResidence: "FRA",
			departure: "2026-07-15",
			documentCountry: "FRA",
			documentId: "123456789",
			documentType: "P",
			firstName: "Alana",
			lastName: "Bolsch",
			nationality: "FRA",
			rcode: "HMK71DA91ALK",
		});
	});

	it("reports missing fields by name without values", () => {
		const result = buildHostkitGuest(
			{
				...COMPLETE_GUEST,
				documentNumber: null,
				nationality: null,
			},
			STAY,
		);
		expect(result.kind).toBe("incomplete");
		if (result.kind !== "incomplete") {
			return;
		}
		expect(result.missing).toContain("documentNumber");
		expect(result.missing).toContain("nationality");
		expect(result.missing.join(" ")).not.toContain("Alana");
	});

	it("rejects unmappable country codes", () => {
		const result = buildHostkitGuest(
			{ ...COMPLETE_GUEST, residenceCountry: "ZZ" },
			STAY,
		);
		expect(result.kind).toBe("incomplete");
	});

	it("refuses document numbers beyond the Hostkit limit", () => {
		const result = buildHostkitGuest(
			{ ...COMPLETE_GUEST, documentNumber: "X".repeat(17) },
			STAY,
		);
		expect(result.kind).toBe("incomplete");
		if (result.kind !== "incomplete") {
			return;
		}
		expect(result.missing).toContain("documentNumber(too long)");
	});

	it("long names return incomplete", () => {
		const result = buildHostkitGuest(
			{ ...COMPLETE_GUEST, firstName: "A".repeat(60) },
			STAY,
		);
		expect(result.kind).toBe("incomplete");
		if (result.kind !== "incomplete") {
			return;
		}
		expect(result.missing).toContain("firstName(too long)");
	});
});

describe("classifyGuestSubmissionError", () => {
	it("treats an unknown reservation code as awaiting provider ingestion", () => {
		const error = new HostkitApiError("Hostkit rejected validateSIBA", 200, {
			providerMessage: "Unknown reservation code",
		});
		expect(classifyGuestSubmissionError(error)).toBe("awaiting_provider");
	});

	it("treats network and timeout failures as transient", () => {
		expect(classifyGuestSubmissionError(new HostkitTimeoutError("slow"))).toBe(
			"transient",
		);
		expect(classifyGuestSubmissionError(new HostkitNetworkError("down"))).toBe(
			"transient",
		);
		expect(
			classifyGuestSubmissionError(
				new HostkitApiError("rate limited", 429, {
					providerMessage: "Limit exceeded",
				}),
			),
		).toBe("transient");
	});

	it("treats provider rejections and unknown errors as permanent", () => {
		expect(
			classifyGuestSubmissionError(
				new HostkitApiError("bad key", 200, {
					providerMessage: "Incorrect APIKEY provided",
				}),
			),
		).toBe("permanent");
		expect(classifyGuestSubmissionError(new Error("boom"))).toBe("permanent");
	});
});

describe("nextGuestSubmissionDelayMs", () => {
	it("walks the ladder and plateaus at six hours", () => {
		expect(nextGuestSubmissionDelayMs(1)).toBe(5 * 60 * 1000);
		expect(nextGuestSubmissionDelayMs(2)).toBe(15 * 60 * 1000);
		expect(nextGuestSubmissionDelayMs(5)).toBe(360 * 60 * 1000);
		expect(nextGuestSubmissionDelayMs(11)).toBe(360 * 60 * 1000);
	});
});

describe("nextGuestInfoReminderDelayMs", () => {
	const now = new Date("2026-07-01T12:00:00.000Z");

	it("caps far-away reminders at the quiet maximum", () => {
		const stayStartsAt = new Date("2026-09-01T12:00:00.000Z");
		expect(nextGuestInfoReminderDelayMs(now, stayStartsAt)).toBe(
			GUEST_INFO_REMINDER_MAX_DELAY_MS,
		);
	});

	it("halves the remaining time as check-in approaches", () => {
		const stayStartsAt = new Date("2026-07-09T12:00:00.000Z");
		expect(nextGuestInfoReminderDelayMs(now, stayStartsAt)).toBe(
			4 * 24 * 60 * 60 * 1000,
		);
	});

	it("keeps a minimum useful delay near arrival", () => {
		const stayStartsAt = new Date("2026-07-01T20:00:00.000Z");
		expect(nextGuestInfoReminderDelayMs(now, stayStartsAt)).toBe(
			GUEST_INFO_REMINDER_MIN_DELAY_MS,
		);
	});

	it("stops scheduling once the minimum delay would land after check-in", () => {
		const stayStartsAt = new Date("2026-07-01T14:00:00.000Z");
		expect(nextGuestInfoReminderDelayMs(now, stayStartsAt)).toBeNull();
		expect(nextGuestInfoReminderDelayMs(stayStartsAt, stayStartsAt)).toBeNull();
	});
});
