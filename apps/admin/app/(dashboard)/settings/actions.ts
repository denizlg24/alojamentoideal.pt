"use server";

import {
	deleteHostkitListingApiKey,
	type RuntimeSettingKey,
	runtimeSettingDefinitions,
	setHostkitListingApiKey,
	updateRuntimeSettings,
} from "@workspace/core/settings";
import type { AppSettingValue } from "@workspace/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/auth/admin";

function settingsErrorRedirect(message: string): never {
	redirect(`/settings?error=${encodeURIComponent(message)}`);
}

export async function saveSettings(formData: FormData): Promise<void> {
	await requireAdminUser();

	const values: Partial<Record<RuntimeSettingKey, AppSettingValue>> = {};
	try {
		for (const definition of runtimeSettingDefinitions) {
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
