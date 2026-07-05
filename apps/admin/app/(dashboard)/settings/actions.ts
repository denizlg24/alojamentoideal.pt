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

export async function saveSettings(formData: FormData): Promise<void> {
	await requireAdminUser();

	const values: Partial<Record<RuntimeSettingKey, AppSettingValue>> = {};
	for (const definition of runtimeSettingDefinitions) {
		if (definition.type === "boolean") {
			values[definition.key as RuntimeSettingKey] =
				formData.get(definition.key) === "on";
			continue;
		}
		const raw = String(formData.get(definition.key) ?? "").trim();
		values[definition.key as RuntimeSettingKey] =
			definition.type === "integer" ? Number(raw) : raw;
	}

	await updateRuntimeSettings(values);
	revalidatePath("/settings");
	redirect("/settings?saved=settings");
}

export async function saveHostkitListingKey(formData: FormData): Promise<void> {
	await requireAdminUser();

	const listingExternalId = String(formData.get("listingExternalId") ?? "");
	const apiKey = String(formData.get("apiKey") ?? "");
	await setHostkitListingApiKey(listingExternalId, apiKey);
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
