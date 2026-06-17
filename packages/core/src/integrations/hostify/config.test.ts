import { describe, expect, it } from "bun:test";
import { createHostifyClientFromEnv, HostifyConfigurationError } from "./index";

describe("Hostify environment configuration", () => {
	it("requires an API key", () => {
		expect(() => createHostifyClientFromEnv({})).toThrow(
			HostifyConfigurationError,
		);
	});

	it("rejects invalid numeric options", () => {
		expect(() =>
			createHostifyClientFromEnv({
				HOSTIFY_API_KEY: "key",
				HOSTIFY_TIMEOUT_MS: "not-a-number",
			}),
		).toThrow(HostifyConfigurationError);
	});
});
