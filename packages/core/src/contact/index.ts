import { randomUUID } from "node:crypto";
import { contactMessage, type Database, getDb } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

export const contactMessageInputSchema = z.object({
	name: z.string().trim().min(2).max(120),
	email: z.string().trim().toLowerCase().email().max(254),
	subject: z.string().trim().min(2).max(200),
	message: z.string().trim().min(16).max(2048),
});

export type ContactMessageInput = z.infer<typeof contactMessageInputSchema>;
export type ContactMessage = typeof contactMessage.$inferSelect;

export async function createContactMessage(
	input: ContactMessageInput,
	db: Database = getDb(),
): Promise<ContactMessage> {
	const [message] = await db
		.insert(contactMessage)
		.values({
			id: randomUUID(),
			...input,
		})
		.returning();

	if (!message) {
		throw new Error("Contact message could not be created");
	}

	return message;
}

export async function listContactMessages(
	limit = 100,
	db: Database = getDb(),
): Promise<ContactMessage[]> {
	return db
		.select()
		.from(contactMessage)
		.orderBy(desc(contactMessage.createdAt))
		.limit(Math.min(Math.max(limit, 1), 500));
}

export async function markContactMessageNotification(
	id: string,
	result: { error?: string; sentAt?: Date },
	db: Database = getDb(),
): Promise<void> {
	await db
		.update(contactMessage)
		.set({
			notificationError: result.error ?? null,
			notificationSentAt: result.sentAt ?? null,
			updatedAt: new Date(),
		})
		.where(eq(contactMessage.id, id));
}

export async function markContactMessageRead(
	id: string,
	db: Database = getDb(),
): Promise<void> {
	await db
		.update(contactMessage)
		.set({
			readAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(contactMessage.id, id));
}
