import { BokunClient } from "./client";
import { BokunConfigurationError } from "./errors";

interface BokunEnvironment {
	BOKUN_ACCESS_KEY?: string;
	BOKUN_BASE_URL?: string;
	BOKUN_MAX_READ_RETRIES?: string;
	BOKUN_RETRY_DELAY_MS?: string;
	BOKUN_SECRET_KEY?: string;
	BOKUN_TIMEOUT_MS?: string;
}

export function createBokunClientFromEnv(
	environment: BokunEnvironment = {
		BOKUN_ACCESS_KEY: process.env.BOKUN_ACCESS_KEY,
		BOKUN_BASE_URL: process.env.BOKUN_BASE_URL,
		BOKUN_MAX_READ_RETRIES: process.env.BOKUN_MAX_READ_RETRIES,
		BOKUN_RETRY_DELAY_MS: process.env.BOKUN_RETRY_DELAY_MS,
		BOKUN_SECRET_KEY: process.env.BOKUN_SECRET_KEY,
		BOKUN_TIMEOUT_MS: process.env.BOKUN_TIMEOUT_MS,
	},
): BokunClient {
	const accessKey = environment.BOKUN_ACCESS_KEY;
	if (!accessKey) {
		throw new BokunConfigurationError("BOKUN_ACCESS_KEY is required");
	}

	const secretKey = environment.BOKUN_SECRET_KEY;
	if (!secretKey) {
		throw new BokunConfigurationError("BOKUN_SECRET_KEY is required");
	}

	return new BokunClient({
		accessKey,
		baseUrl: environment.BOKUN_BASE_URL,
		maxReadRetries: optionalNumber(
			"BOKUN_MAX_READ_RETRIES",
			environment.BOKUN_MAX_READ_RETRIES,
		),
		retryDelayMs: optionalNumber(
			"BOKUN_RETRY_DELAY_MS",
			environment.BOKUN_RETRY_DELAY_MS,
		),
		secretKey,
		timeoutMs: optionalNumber("BOKUN_TIMEOUT_MS", environment.BOKUN_TIMEOUT_MS),
	});
}

function optionalNumber(name: string, value: string | undefined) {
	if (value === undefined) {
		return undefined;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new BokunConfigurationError(`${name} must be a number`);
	}

	return parsed;
}
