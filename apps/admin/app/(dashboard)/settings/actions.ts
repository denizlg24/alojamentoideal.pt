"use server";

import {
	deleteHostkitListingApiKey,
	getRuntimeSettings,
	type RuntimeSettingKey,
	runtimeSettingDefinitions,
	setHostkitListingApiKey,
	updateRuntimeSettings,
} from "@workspace/core/settings";
import type { AppSettingValue } from "@workspace/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/auth/admin";

const MANUAL_RESYNC_VERSION_KEYS = [
	"hostify.listingSyncVersion",
	"bokun.activitySyncVersion",
] as const satisfies readonly RuntimeSettingKey[];

function settingsErrorRedirect(message: string): never {
	redirect(`/settings?error=${encodeURIComponent(message)}`);
}

export async function saveSettings(formData: FormData): Promise<void> {
	await requireAdminUser();

	// Each settings accordion submits its own form tagged with `__group`, so only
	// that group's definitions are read. This keeps saves partial (collapsed
	// groups are unmounted and would otherwise submit no fields) and lets a
	// checkbox's absence mean "off" without wiping the other groups.
	const group = String(formData.get("__group") ?? "").trim();
	const definitions = group
		? runtimeSettingDefinitions.filter(
				(definition) => definition.group === group,
			)
		: runtimeSettingDefinitions;

	if (definitions.length === 0) {
		settingsErrorRedirect("Unknown settings section.");
	}

	const values: Partial<Record<RuntimeSettingKey, AppSettingValue>> = {};
	try {
		for (const definition of definitions) {
			if (definition.type === "boolean") {
				values[definition.key as RuntimeSettingKey] =
					formData.get(definition.key) === "on";
				continue;
			}
			const raw = String(formData.get(definition.key) ?? "").trim();
			if (definition.type === "integer") {
				if (!/^-?\d+$/.test(raw)) {
					throw new Error(`${definition.label} must be an integer`);
				}
				values[definition.key as RuntimeSettingKey] = Number(raw);
				continue;
			}
			values[definition.key as RuntimeSettingKey] = raw;
		}
		await updateRuntimeSettings(values);
	} catch (error) {
		settingsErrorRedirect(
			error instanceof Error ? error.message : "Settings could not be saved.",
		);
	}

	revalidatePath("/settings");
	redirect("/settings?saved=settings");
}

export async function bumpManualSyncVersion(): Promise<void> {
	await requireAdminUser();

	try {
		const settings = await getRuntimeSettings();
		const values: Partial<Record<RuntimeSettingKey, AppSettingValue>> = {};

		for (const key of MANUAL_RESYNC_VERSION_KEYS) {
			const current = settings[key];
			if (typeof current !== "number" || !Number.isInteger(current)) {
				throw new Error("Sync version settings must be integers");
			}
			values[key] = current + 1;
		}

		await updateRuntimeSettings(values);
	} catch (error) {
		settingsErrorRedirect(
			error instanceof Error
				? error.message
				: "Manual resync could not be requested.",
		);
	}

	revalidatePath("/settings");
	redirect("/settings?saved=sync");
}

export async function saveHostkitListingKey(formData: FormData): Promise<void> {
	await requireAdminUser();

	const listingExternalId = String(formData.get("listingExternalId") ?? "");
	const apiKey = String(formData.get("apiKey") ?? "");
	try {
		await setHostkitListingApiKey(listingExternalId, apiKey);
	} catch (error) {
		settingsErrorRedirect(
			error instanceof Error
				? error.message
				: "Hostkit key could not be saved.",
		);
	}
	revalidatePath("/settings");
	redirect("/settings?saved=hostkit");
}

export async function removeHostkitListingKey(
	formData: FormData,
): Promise<void> {
	await requireAdminUser();

	const listingExternalId = String(formData.get("listingExternalId") ?? "");
	await deleteHostkitListingApiKey(listingExternalId);
	revalidatePath("/settings");
	redirect("/settings?saved=hostkit");
}
