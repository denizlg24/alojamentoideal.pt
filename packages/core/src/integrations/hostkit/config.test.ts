import { describe, expect, it } from "bun:test";
import {
	createHostkitClientForListing,
	HostkitConfigurationError,
	isHostkitConfigured,
	resolveHostkitApiKey,
} from "./index";

describe("hostkit config", () => {
	it("resolves per-listing API keys from the JSON map", () => {
		const environment = {
			HOSTKIT_API_KEYS: JSON.stringify({ "12345": "key-a", "678": "key-b" }),
		};

		expect(resolveHostkitApiKey("12345", environment)).toBe("key-a");
		expect(resolveHostkitApiKey("678", environment)).toBe("key-b");
		expect(resolveHostkitApiKey("999", environment)).toBeNull();
		expect(isHostkitConfigured(environment)).toBe(true);
	});

	it("reports unconfigured when the map is missing or empty", () => {
		expect(isHostkitConfigured({})).toBe(false);
		expect(isHostkitConfigured({ HOSTKIT_API_KEYS: "  " })).toBe(false);
		expect(resolveHostkitApiKey("1", {})).toBeNull();
	});

	it("rejects malformed maps", () => {
		expect(() =>
			resolveHostkitApiKey("1", { HOSTKIT_API_KEYS: "not-json" }),
		).toThrow(HostkitConfigurationError);
		expect(() =>
			resolveHostkitApiKey("1", { HOSTKIT_API_KEYS: '["key"]' }),
		).toThrow(HostkitConfigurationError);
		expect(() =>
			resolveHostkitApiKey("1", { HOSTKIT_API_KEYS: '{"1": 5}' }),
		).toThrow(HostkitConfigurationError);
	});

	it("builds a client only for listings with a key", () => {
		const environment = {
			HOSTKIT_API_KEYS: JSON.stringify({ "12345": "key-a" }),
		};

		expect(createHostkitClientForListing("12345", environment)).not.toBeNull();
		expect(createHostkitClientForListing("999", environment)).toBeNull();
	});

	it("validates numeric overrides", () => {
		expect(() =>
			createHostkitClientForListing("12345", {
				HOSTKIT_API_KEYS: JSON.stringify({ "12345": "key-a" }),
				HOSTKIT_TIMEOUT_MS: "soon",
			}),
		).toThrow(HostkitConfigurationError);
	});
});
