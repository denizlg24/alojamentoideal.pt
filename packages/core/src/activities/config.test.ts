import { describe, expect, test } from "bun:test";
import { validateRuntimeSettingValue } from "../settings";
import { getActivityCacheConfig, parseActivityIdList } from "./config";
import { DEFAULT_ACTIVITY_IDS } from "./defaults";

describe("parseActivityIdList", () => {
	test("normalizes numeric ids and removes duplicates", () => {
		expect(parseActivityIdList(" 1,2,abc,1, 3 ")).toEqual(["1", "2", "3"]);
	});
});

describe("getActivityCacheConfig", () => {
	test("uses defaults when activity ids are unset", () => {
		expect(getActivityCacheConfig({}).activityIds).toEqual([
			...DEFAULT_ACTIVITY_IDS,
		]);
	});

	test("allows an explicitly empty activity id list", () => {
		expect(
			getActivityCacheConfig({ BOKUN_ACTIVITY_IDS: "" }).activityIds,
		).toEqual([]);
		expect(
			getActivityCacheConfig({ BOKUN_ACTIVITY_IDS: "   " }).activityIds,
		).toEqual([]);
	});

	test("uses configured activity ids when present", () => {
		expect(
			getActivityCacheConfig({ BOKUN_ACTIVITY_IDS: "42, 7,42" }).activityIds,
		).toEqual(["42", "7"]);
	});
});

describe("activity id runtime setting validation", () => {
	test("accepts an empty activity id setting", () => {
		expect(validateRuntimeSettingValue("bokun.activityIds", "")).toBe("");
		expect(validateRuntimeSettingValue("bokun.activityIds", "   ")).toBe("");
	});

	test("still rejects invalid non-empty activity id settings", () => {
		expect(() =>
			validateRuntimeSettingValue("bokun.activityIds", "42,none"),
		).toThrow("Activity ids must be a comma-separated list of Bokun ids");
	});
});
