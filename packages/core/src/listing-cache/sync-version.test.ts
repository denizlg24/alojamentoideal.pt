import { describe, expect, test } from "bun:test";
import {
	DEFAULT_LISTING_SYNC_VERSION,
	getListingSyncVersion,
} from "./sync-version";

describe("getListingSyncVersion", () => {
	test("uses the code default when the env var is absent or blank", () => {
		expect(getListingSyncVersion({})).toBe(DEFAULT_LISTING_SYNC_VERSION);
		expect(getListingSyncVersion({ LISTING_SYNC_VERSION: " " })).toBe(
			DEFAULT_LISTING_SYNC_VERSION,
		);
	});

	test("uses a valid integer env override", () => {
		expect(getListingSyncVersion({ LISTING_SYNC_VERSION: "9" })).toBe(9);
		expect(getListingSyncVersion({ LISTING_SYNC_VERSION: "0" })).toBe(0);
	});

	test("rejects invalid values", () => {
		expect(() =>
			getListingSyncVersion({ LISTING_SYNC_VERSION: "next" }),
		).toThrow("LISTING_SYNC_VERSION must be an integer");
		expect(() =>
			getListingSyncVersion({ LISTING_SYNC_VERSION: "1.5" }),
		).toThrow("LISTING_SYNC_VERSION must be an integer");
		expect(() => getListingSyncVersion({ LISTING_SYNC_VERSION: "-1" })).toThrow(
			"LISTING_SYNC_VERSION must be an integer",
		);
	});
});
