import { describe, expect, it } from "bun:test";
import { BokunConfigurationError, createBokunClientFromEnv } from "./index";

describe("Bokun environment configuration", () => {
	it("requires an access key", () => {
		expect(() => createBokunClientFromEnv({})).toThrow(BokunConfigurationError);
	});

	it("requires a secret key", () => {
		expect(() =>
			createBokunClientFromEnv({ BOKUN_ACCESS_KEY: "access" }),
		).toThrow(BokunConfigurationError);
	});

	it("rejects invalid numeric options", () => {
		expect(() =>
			createBokunClientFromEnv({
				BOKUN_ACCESS_KEY: "access",
				BOKUN_SECRET_KEY: "secret",
				BOKUN_TIMEOUT_MS: "not-a-number",
			}),
		).toThrow(BokunConfigurationError);
	});

	it("builds a client when keys are present", () => {
		expect(() =>
			createBokunClientFromEnv({
				BOKUN_ACCESS_KEY: "access",
				BOKUN_SECRET_KEY: "secret",
			}),
		).not.toThrow();
	});
});
