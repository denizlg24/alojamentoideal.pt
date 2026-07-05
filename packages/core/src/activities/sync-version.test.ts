import { describe, expect, test } from "bun:test";
import {
	DEFAULT_ACTIVITY_SYNC_VERSION,
	getActivitySyncVersion,
} from "./sync-version";

describe("getActivitySyncVersion", () => {
	test("uses the code default when the env var is absent or blank", () => {
		expect(getActivitySyncVersion({})).toBe(DEFAULT_ACTIVITY_SYNC_VERSION);
		expect(getActivitySyncVersion({ ACTIVITY_SYNC_VERSION: " " })).toBe(
			DEFAULT_ACTIVITY_SYNC_VERSION,
		);
	});

	test("uses a valid integer env override", () => {
		expect(getActivitySyncVersion({ ACTIVITY_SYNC_VERSION: "2" })).toBe(2);
		expect(getActivitySyncVersion({ ACTIVITY_SYNC_VERSION: "0" })).toBe(0);
	});

	test("rejects invalid values", () => {
		expect(() =>
			getActivitySyncVersion({ ACTIVITY_SYNC_VERSION: "next" }),
		).toThrow("ACTIVITY_SYNC_VERSION must be an integer");
		expect(() =>
			getActivitySyncVersion({ ACTIVITY_SYNC_VERSION: "1.5" }),
		).toThrow("ACTIVITY_SYNC_VERSION must be an integer");
		expect(() =>
			getActivitySyncVersion({ ACTIVITY_SYNC_VERSION: "-1" }),
		).toThrow("ACTIVITY_SYNC_VERSION must be an integer");
	});
});
