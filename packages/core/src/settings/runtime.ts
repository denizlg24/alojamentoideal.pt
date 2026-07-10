import {
	type AppSettingValue,
	accommodationListing,
	appSetting,
	type Database,
	getDb,
	listingHostkitCredential,
} from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
	decryptIdentityField,
	encryptIdentityField,
} from "../account/identity-encryption";
import {
	type RuntimeSettingKey,
	runtimeSettingDefinitionByKey,
	runtimeSettingDefinitions,
} from "./definitions";

export type RuntimeSettings = Record<RuntimeSettingKey, AppSettingValue>;

export interface HostkitListingCredentialSummary {
	hasApiKey: boolean;
	keyHint: string | null;
	listingExternalId: string;
	listingName: string | null;
}

function envValue(name: string | undefined): string | undefined {
	if (!name) {
		return undefined;
	}
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function coerceEnvValue(
	raw: string | undefined,
	fallback: AppSettingValue,
	type: "boolean" | "integer" | "string",
): AppSettingValue {
	if (raw === undefined) {
		return fallback;
	}
	if (type === "boolean") {
		return !["0", "false", "no", "off"].includes(raw.toLowerCase());
	}
	if (type === "integer") {
		const parsed = Number(raw);
		if (!Number.isInteger(parsed)) {
			throw new Error(`Environment value must be an integer`);
		}
		return parsed;
	}
	return raw;
}

function coerceStoredValue(
	value: AppSettingValue | undefined,
	type: "boolean" | "integer" | "string",
): AppSettingValue {
	if (value === undefined) {
		throw new Error("Setting value is missing");
	}
	if (type === "boolean") {
		if (typeof value !== "boolean") {
			throw new Error("Setting value must be a boolean");
		}
		return value;
	}
	if (type === "integer") {
		if (typeof value !== "number" || !Number.isInteger(value)) {
			throw new Error("Setting value must be an integer");
		}
		return value;
	}
	if (typeof value !== "string") {
		throw new Error("Setting value must be a string");
	}
	return value;
}

export function validateRuntimeSettingValue(
	key: RuntimeSettingKey,
	value: AppSettingValue,
): AppSettingValue {
	const definition = runtimeSettingDefinitionByKey.get(key);
	if (!definition) {
		throw new Error(`Unknown setting ${key}`);
	}
	const coerced = coerceStoredValue(value, definition.type);
	if (definition.type === "integer") {
		const numeric = Number(coerced);
		if (
			(definition.min !== undefined && numeric < definition.min) ||
			(definition.max !== undefined && numeric > definition.max)
		) {
			throw new Error(
				`${definition.label} must be between ${definition.min} and ${definition.max}`,
			);
		}
		return numeric;
	}
	if (definition.type === "string") {
		const trimmed = String(coerced).trim();
		if (key === "bokun.activityCurrency" && trimmed) {
			if (!/^[A-Za-z]{3}$/.test(trimmed)) {
				throw new Error(`${definition.label} must be a 3-letter code`);
			}
			return trimmed.toUpperCase();
		}
		if (key === "bokun.activityIds") {
			if (!trimmed) {
				return "";
			}
			const ids = trimmed
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean);
			if (ids.some((value) => !/^\d+$/.test(value))) {
				throw new Error(
					`${definition.label} must be a comma-separated list of Bokun ids`,
				);
			}
			return [...new Set(ids)].join(",");
		}
		if (key === "payments.detoursStripeAccountId" && trimmed) {
			if (!/^acct_[A-Za-z0-9]+$/.test(trimmed)) {
				throw new Error(
					`${definition.label} must be a Stripe connected account id (acct_...)`,
				);
			}
		}
		if (key === "communications.ownerContactEmail") {
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
				throw new Error(`${definition.label} must be a valid email address`);
			}
			return trimmed.toLowerCase();
		}
		if (key === "bokun.activityLang" && trimmed) {
			if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/.test(trimmed)) {
				throw new Error(`${definition.label} must be a language code`);
			}
			return trimmed;
		}
		if (key === "hostkit.baseUrl" && trimmed) {
			let parsed: URL;
			try {
				parsed = new URL(trimmed);
			} catch {
				throw new Error(`${definition.label} must be a valid URL`);
			}
			if (parsed.protocol !== "https:") {
				throw new Error(`${definition.label} must use HTTPS`);
			}
		}
		return trimmed;
	}
	return Boolean(coerced);
}

const RUNTIME_SETTINGS_CACHE_MS = 5000;

let runtimeSettingsCache:
	| {
			db: Database;
			expiresAt: number;
			promise: Promise<RuntimeSettings>;
	  }
	| undefined;

function clearRuntimeSettingsCache() {
	runtimeSettingsCache = undefined;
}

export async function getRuntimeSettings(
	db: Database = getDb(),
): Promise<RuntimeSettings> {
	const now = Date.now();
	if (
		runtimeSettingsCache &&
		runtimeSettingsCache.db === db &&
		runtimeSettingsCache.expiresAt > now
	) {
		return runtimeSettingsCache.promise;
	}

	const promise = loadRuntimeSettings(db);
	runtimeSettingsCache = {
		db,
		expiresAt: now + RUNTIME_SETTINGS_CACHE_MS,
		promise,
	};
	try {
		return await promise;
	} catch (error) {
		if (runtimeSettingsCache?.promise === promise) {
			clearRuntimeSettingsCache();
		}
		throw error;
	}
}

async function loadRuntimeSettings(db: Database): Promise<RuntimeSettings> {
	const keys = runtimeSettingDefinitions.map((definition) => definition.key);
	const rows =
		keys.length === 0
			? []
			: await db
					.select({ key: appSetting.key, value: appSetting.value })
					.from(appSetting)
					.where(inArray(appSetting.key, keys));
	const stored = new Map(rows.map((row) => [row.key, row.value]));
	const settings = {} as RuntimeSettings;

	for (const definition of runtimeSettingDefinitions) {
		const key = definition.key as RuntimeSettingKey;
		try {
			const envFallback = validateRuntimeSettingValue(
				key,
				coerceEnvValue(
					envValue("envName" in definition ? definition.envName : undefined),
					definition.defaultValue,
					definition.type,
				),
			);
			const storedValue = stored.get(definition.key);
			const rawValue = storedValue === undefined ? envFallback : storedValue;
			settings[key] = validateRuntimeSettingValue(key, rawValue);
		} catch (error) {
			console.warn(
				`Invalid runtime setting ${definition.key}; using default value.`,
				error,
			);
			settings[key] = validateRuntimeSettingValue(key, definition.defaultValue);
		}
	}

	return settings;
}

export async function updateRuntimeSettings(
	values: Partial<Record<RuntimeSettingKey, AppSettingValue>>,
	db: Database = getDb(),
): Promise<void> {
	const now = new Date();
	await db.transaction(async (tx) => {
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined) {
				continue;
			}
			const validated = validateRuntimeSettingValue(
				key as RuntimeSettingKey,
				value,
			);
			await tx
				.insert(appSetting)
				.values({ key, updatedAt: now, value: validated })
				.onConflictDoUpdate({
					set: { updatedAt: now, value: validated },
					target: appSetting.key,
				});
		}
	});
	clearRuntimeSettingsCache();
}

export async function listHostkitListingCredentials(
	db: Database = getDb(),
): Promise<HostkitListingCredentialSummary[]> {
	const rows = await db
		.select({
			keyHint: listingHostkitCredential.keyHint,
			listingExternalId: accommodationListing.externalId,
			listingName: accommodationListing.name,
			processed: accommodationListing.processed,
		})
		.from(accommodationListing)
		.leftJoin(
			listingHostkitCredential,
			eq(
				listingHostkitCredential.listingExternalId,
				accommodationListing.externalId,
			),
		)
		.where(
			and(
				eq(accommodationListing.provider, "hostify"),
				eq(accommodationListing.active, true),
			),
		)
		.orderBy(
			asc(accommodationListing.name),
			asc(accommodationListing.externalId),
		);

	return rows.map((row) => ({
		hasApiKey: row.keyHint !== null,
		keyHint: row.keyHint,
		listingExternalId: row.listingExternalId,
		listingName:
			pickLocalizedTitle(row.processed.title) ??
			row.listingName ??
			row.listingExternalId,
	}));
}

function pickLocalizedTitle(
	title: { en: string; es: string; pt: string } | null | undefined,
): string | null {
	const value = (title?.en || title?.pt || title?.es || "").trim();
	return value.length > 0 ? value : null;
}

export async function setHostkitListingApiKey(
	listingExternalId: string,
	apiKey: string,
	db: Database = getDb(),
): Promise<void> {
	const trimmedListingId = listingExternalId.trim();
	const trimmedApiKey = apiKey.trim();
	if (!trimmedListingId || !trimmedApiKey) {
		throw new Error("Listing id and Hostkit API key are required");
	}
	const now = new Date();
	const encrypted = encryptIdentityField(trimmedApiKey);
	if (!encrypted) {
		throw new Error("Failed to encrypt Hostkit API key");
	}
	await db
		.insert(listingHostkitCredential)
		.values({
			apiKeyEncrypted: encrypted,
			keyHint: keyHint(trimmedApiKey),
			listingExternalId: trimmedListingId,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			set: {
				apiKeyEncrypted: encrypted,
				keyHint: keyHint(trimmedApiKey),
				updatedAt: now,
			},
			target: listingHostkitCredential.listingExternalId,
		});
}

export async function deleteHostkitListingApiKey(
	listingExternalId: string,
	db: Database = getDb(),
): Promise<void> {
	await db
		.delete(listingHostkitCredential)
		.where(eq(listingHostkitCredential.listingExternalId, listingExternalId));
}

export async function resolveEncryptedHostkitApiKey(
	listingExternalId: string,
	db: Database = getDb(),
): Promise<string | null> {
	const [row] = await db
		.select({ apiKeyEncrypted: listingHostkitCredential.apiKeyEncrypted })
		.from(listingHostkitCredential)
		.where(eq(listingHostkitCredential.listingExternalId, listingExternalId))
		.limit(1);
	return row ? decryptIdentityField(row.apiKeyEncrypted) : null;
}

export async function anyHostkitListingCredentialConfigured(
	db: Database = getDb(),
): Promise<boolean> {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(listingHostkitCredential);
	return (row?.count ?? 0) > 0;
}

function keyHint(value: string): string {
	if (value.length <= 8) {
		return "saved";
	}
	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
