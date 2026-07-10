import { randomUUID } from "node:crypto";
import { type Database, getDb, propertyOwnerContact } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

export const propertyOwnerContactInputSchema = z.object({
	fullName: z.string().trim().min(2).max(120),
	email: z.string().trim().toLowerCase().email().max(254),
	phoneNumber: z.string().trim().min(7).max(32),
	propertyAddress: z.string().trim().min(3).max(240),
	propertyLocation: z.string().trim().min(2).max(120),
	propertyCount: z.number().int().min(1).max(999),
	bedroomCount: z.number().int().min(0).max(999),
});

export type PropertyOwnerContactInput = z.infer<
	typeof propertyOwnerContactInputSchema
>;
export type PropertyOwnerContact = typeof propertyOwnerContact.$inferSelect;

export async function createPropertyOwnerContact(
	input: PropertyOwnerContactInput,
	db: Database = getDb(),
): Promise<PropertyOwnerContact> {
	const [contact] = await db
		.insert(propertyOwnerContact)
		.values({
			id: randomUUID(),
			...input,
		})
		.returning();

	if (!contact) {
		throw new Error("Property owner contact could not be created");
	}

	return contact;
}

export async function listPropertyOwnerContacts(
	limit = 100,
	db: Database = getDb(),
): Promise<PropertyOwnerContact[]> {
	return db
		.select()
		.from(propertyOwnerContact)
		.orderBy(desc(propertyOwnerContact.createdAt))
		.limit(Math.min(Math.max(limit, 1), 500));
}

export async function markPropertyOwnerContactNotification(
	id: string,
	result: { error?: string; sentAt?: Date },
	db: Database = getDb(),
): Promise<void> {
	await db
		.update(propertyOwnerContact)
		.set({
			notificationError: result.error ?? null,
			notificationSentAt: result.sentAt ?? null,
			updatedAt: new Date(),
		})
		.where(eq(propertyOwnerContact.id, id));
}
