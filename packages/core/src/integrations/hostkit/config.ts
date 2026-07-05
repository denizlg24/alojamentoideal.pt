import {
	anyHostkitListingCredentialConfigured,
	getRuntimeSettings,
	resolveEncryptedHostkitApiKey,
} from "../../settings";
import { HostkitClient } from "./client";
import { HostkitConfigurationError } from "./errors";

export interface HostkitEnvironment {
	/**
	 * JSON object mapping provider listing ids (Hostify listing ids) to the
	 * property-scoped Hostkit API key, e.g. `{"12345":"abcdef..."}`. Hostkit
	 * issues one key per property, so a shared account-wide key does not exist.
	 */
	HOSTKIT_API_KEYS?: string;
	HOSTKIT_BASE_URL?: string;
	HOSTKIT_MAX_READ_RETRIES?: string;
	HOSTKIT_RETRY_DELAY_MS?: string;
	HOSTKIT_TIMEOUT_MS?: string;
	HOSTKIT_UID?: string;
}

function environmentFromProcess(): HostkitEnvironment {
	return {
		HOSTKIT_API_KEYS: process.env.HOSTKIT_API_KEYS,
		HOSTKIT_BASE_URL: process.env.HOSTKIT_BASE_URL,
		HOSTKIT_MAX_READ_RETRIES: process.env.HOSTKIT_MAX_READ_RETRIES,
		HOSTKIT_RETRY_DELAY_MS: process.env.HOSTKIT_RETRY_DELAY_MS,
		HOSTKIT_TIMEOUT_MS: process.env.HOSTKIT_TIMEOUT_MS,
		HOSTKIT_UID: process.env.HOSTKIT_UID,
	};
}

/** True when at least one Hostkit property key is configured. */
export function isHostkitConfigured(
	environment: HostkitEnvironment = environmentFromProcess(),
): boolean {
	try {
		return Object.keys(parseApiKeyMap(environment)).length > 0;
	} catch {
		return false;
	}
}

/**
 * Resolves the property-scoped Hostkit API key for a provider listing id, or
 * `null` when the listing has no key configured (the property is not managed
 * through Hostkit, or the key has not been provisioned yet).
 */
export function resolveHostkitApiKey(
	listingId: string,
	environment: HostkitEnvironment = environmentFromProcess(),
): string | null {
	const keys = parseApiKeyMap(environment);
	return keys[listingId] ?? null;
}

/**
 * Builds a client bound to the property that owns `listingId`, or `null` when
 * no key is configured for it. Callers treat `null` as "Hostkit not set up for
 * this listing" rather than an error so partial rollouts stay operable.
 */
export function createHostkitClientForListing(
	listingId: string,
	environment: HostkitEnvironment = environmentFromProcess(),
): HostkitClient | null {
	const apiKey = resolveHostkitApiKey(listingId, environment);
	if (apiKey === null) {
		return null;
	}

	return new HostkitClient({
		apiKey,
		baseUrl: environment.HOSTKIT_BASE_URL,
		maxReadRetries: optionalNumber(
			"HOSTKIT_MAX_READ_RETRIES",
			environment.HOSTKIT_MAX_READ_RETRIES,
		),
		retryDelayMs: optionalNumber(
			"HOSTKIT_RETRY_DELAY_MS",
			environment.HOSTKIT_RETRY_DELAY_MS,
		),
		timeoutMs: optionalNumber(
			"HOSTKIT_TIMEOUT_MS",
			environment.HOSTKIT_TIMEOUT_MS,
		),
		uid: environment.HOSTKIT_UID ?? undefined,
	});
}

export async function isHostkitConfiguredFromSettings(): Promise<boolean> {
	if (await anyHostkitListingCredentialConfigured()) {
		return true;
	}
	return isHostkitConfigured();
}

export async function createHostkitClientForListingFromSettings(
	listingId: string,
): Promise<HostkitClient | null> {
	const settings = await getRuntimeSettings();
	const apiKey =
		(await resolveEncryptedHostkitApiKey(listingId)) ??
		resolveHostkitApiKey(listingId);
	if (apiKey === null) {
		return null;
	}

	return new HostkitClient({
		apiKey,
		baseUrl: String(settings["hostkit.baseUrl"] || ""),
		maxReadRetries: Number(settings["hostkit.maxReadRetries"]),
		retryDelayMs: Number(settings["hostkit.retryDelayMs"]),
		timeoutMs: Number(settings["hostkit.timeoutMs"]),
		uid: String(settings["hostkit.uid"] || "") || undefined,
	});
}

function parseApiKeyMap(
	environment: HostkitEnvironment,
): Record<string, string> {
	const raw = environment.HOSTKIT_API_KEYS?.trim();
	if (!raw) {
		return {};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new HostkitConfigurationError("HOSTKIT_API_KEYS must be valid JSON", {
			cause: error,
		});
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new HostkitConfigurationError(
			"HOSTKIT_API_KEYS must be a JSON object of listingId -> apiKey",
		);
	}

	const keys: Record<string, string> = {};
	for (const [listingId, apiKey] of Object.entries(parsed)) {
		if (typeof apiKey !== "string" || !apiKey.trim()) {
			throw new HostkitConfigurationError(
				`HOSTKIT_API_KEYS entry for listing ${listingId} must be a non-empty string`,
			);
		}
		keys[listingId.trim()] = apiKey.trim();
	}

	return keys;
}

function optionalNumber(name: string, value: string | undefined) {
	if (value === undefined || value.trim() === "") {
		return undefined;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new HostkitConfigurationError(`${name} must be a number`);
	}

	return parsed;
}
