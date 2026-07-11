"use server";

import { markContactMessageRead } from "@workspace/core/contact";
import { revalidatePath } from "next/cache";
import { requireAdminUser } from "@/lib/auth/admin";

export async function markContactReadAction(formData: FormData): Promise<void> {
	await requireAdminUser();

	const id = String(formData.get("id") ?? "");
	if (!id) return;

	await markContactMessageRead(id);
	revalidatePath("/contacts");
}
