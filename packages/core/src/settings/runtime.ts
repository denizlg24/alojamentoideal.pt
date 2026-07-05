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
		return Number.isInteger(parsed) ? parsed : fallback;
	}
	return raw;
}

function coerceStoredValue(
	value: AppSettingValue | undefined,
	fallback: AppSettingValue,
	type: "boolean" | "integer" | "string",
): AppSettingValue {
	if (value === undefined) {
		return fallback;
	}
	if (type === "boolean") {
		return typeof value === "boolean" ? value : fallback;
	}
	if (type === "integer") {
		return typeof value === "number" && Number.isInteger(value)
			? value
			: fallback;
	}
	return typeof value === "string" ? value : fallback;
}

export function validateRuntimeSettingValue(
	key: RuntimeSettingKey,
	value: AppSettingValue,
): AppSettingValue {
	const definition = runtimeSettingDefinitionByKey.get(key);
	if (!definition) {
		throw new Error(`Unknown setting ${key}`);
	}
	const coerced = coerceStoredValue(
		value,
		definition.defaultValue,
		definition.type,
	);
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
		return String(coerced).trim();
	}
	return Boolean(coerced);
}

export async function getRuntimeSettings(
	db: Database = getDb(),
): Promise<RuntimeSettings> {
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
		const envFallback = coerceEnvValue(
			envValue(definition.envName),
			definition.defaultValue,
			definition.type,
		);
		settings[definition.key as RuntimeSettingKey] = validateRuntimeSettingValue(
			definition.key as RuntimeSettingKey,
			coerceStoredValue(
				stored.get(definition.key),
				envFallback,
				definition.type,
			),
		);
	}

	return settings;
}

export async function updateRuntimeSettings(
	values: Partial<Record<RuntimeSettingKey, AppSettingValue>>,
	db: Database = getDb(),
): Promise<void> {
	const now = new Date();
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) {
			continue;
		}
		const validated = validateRuntimeSettingValue(
			key as RuntimeSettingKey,
			value,
		);
		await db
			.insert(appSetting)
			.values({ key, updatedAt: now, value: validated })
			.onConflictDoUpdate({
				set: { updatedAt: now, value: validated },
				target: appSetting.key,
			});
	}
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
	await db
		.insert(listingHostkitCredential)
		.values({
			apiKeyEncrypted: encrypted ?? Buffer.alloc(0),
			keyHint: keyHint(trimmedApiKey),
			listingExternalId: trimmedListingId,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			set: {
				apiKeyEncrypted: encrypted ?? Buffer.alloc(0),
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
