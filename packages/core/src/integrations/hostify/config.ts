import { HostifyClient } from "./client";
import { HostifyConfigurationError } from "./errors";

interface HostifyEnvironment {
	HOSTIFY_API_KEY?: string;
	HOSTIFY_BASE_URL?: string;
	HOSTIFY_MAX_READ_RETRIES?: string;
	HOSTIFY_RETRY_DELAY_MS?: string;
	HOSTIFY_TIMEOUT_MS?: string;
}

export function createHostifyClientFromEnv(
	environment: HostifyEnvironment = {
		HOSTIFY_API_KEY: process.env.HOSTIFY_API_KEY,
		HOSTIFY_BASE_URL: process.env.HOSTIFY_BASE_URL,
		HOSTIFY_MAX_READ_RETRIES: process.env.HOSTIFY_MAX_READ_RETRIES,
		HOSTIFY_RETRY_DELAY_MS: process.env.HOSTIFY_RETRY_DELAY_MS,
		HOSTIFY_TIMEOUT_MS: process.env.HOSTIFY_TIMEOUT_MS,
	},
): HostifyClient {
	const apiKey = environment.HOSTIFY_API_KEY;
	if (!apiKey) {
		throw new HostifyConfigurationError("HOSTIFY_API_KEY is required");
	}

	return new HostifyClient({
		apiKey,
		baseUrl: environment.HOSTIFY_BASE_URL,
		maxReadRetries: optionalNumber(
			"HOSTIFY_MAX_READ_RETRIES",
			environment.HOSTIFY_MAX_READ_RETRIES,
		),
		retryDelayMs: optionalNumber(
			"HOSTIFY_RETRY_DELAY_MS",
			environment.HOSTIFY_RETRY_DELAY_MS,
		),
		timeoutMs: optionalNumber(
			"HOSTIFY_TIMEOUT_MS",
			environment.HOSTIFY_TIMEOUT_MS,
		),
	});
}

function optionalNumber(name: string, value: string | undefined) {
	if (value === undefined) {
		return undefined;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new HostifyConfigurationError(`${name} must be a number`);
	}

	return parsed;
}
