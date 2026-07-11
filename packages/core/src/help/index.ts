import { randomUUID } from "node:crypto";
import { type Database, getDb, helpArticle } from "@workspace/db";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";

export const helpArticleInputSchema = z.object({
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.regex(
			/^[a-z0-9]+(-[a-z0-9]+)*$/,
			"Use lowercase letters, numbers and hyphens",
		)
		.max(120),
	title: z.string().trim().min(2).max(200),
	excerpt: z.string().trim().min(2).max(300),
	contentMd: z.string().trim().min(1).max(20000),
	published: z.boolean(),
	sortOrder: z.number().int().min(0).max(999),
});

export type HelpArticleInput = z.infer<typeof helpArticleInputSchema>;
export type HelpArticle = typeof helpArticle.$inferSelect;

export class HelpArticleSlugConflictError extends Error {
	constructor(slug: string) {
		super(`A help article with slug "${slug}" already exists`);
		this.name = "HelpArticleSlugConflictError";
	}
}

async function assertSlugAvailable(
	slug: string,
	db: Database,
	excludeId?: string,
): Promise<void> {
	const [existing] = await db
		.select({ id: helpArticle.id })
		.from(helpArticle)
		.where(
			excludeId
				? and(eq(helpArticle.slug, slug), ne(helpArticle.id, excludeId))
				: eq(helpArticle.slug, slug),
		)
		.limit(1);

	if (existing) {
		throw new HelpArticleSlugConflictError(slug);
	}
}

export async function listPublishedHelpArticles(
	db: Database = getDb(),
): Promise<HelpArticle[]> {
	return db
		.select()
		.from(helpArticle)
		.where(eq(helpArticle.published, true))
		.orderBy(asc(helpArticle.sortOrder), asc(helpArticle.title));
}

export async function getPublishedHelpArticleBySlug(
	slug: string,
	db: Database = getDb(),
): Promise<HelpArticle | null> {
	const [article] = await db
		.select()
		.from(helpArticle)
		.where(and(eq(helpArticle.slug, slug), eq(helpArticle.published, true)))
		.limit(1);

	return article ?? null;
}

export async function listHelpArticles(
	db: Database = getDb(),
): Promise<HelpArticle[]> {
	return db
		.select()
		.from(helpArticle)
		.orderBy(asc(helpArticle.sortOrder), asc(helpArticle.title));
}

export async function getHelpArticleById(
	id: string,
	db: Database = getDb(),
): Promise<HelpArticle | null> {
	const [article] = await db
		.select()
		.from(helpArticle)
		.where(eq(helpArticle.id, id))
		.limit(1);

	return article ?? null;
}

export async function createHelpArticle(
	input: HelpArticleInput,
	db: Database = getDb(),
): Promise<HelpArticle> {
	await assertSlugAvailable(input.slug, db);

	const [article] = await db
		.insert(helpArticle)
		.values({
			id: randomUUID(),
			...input,
		})
		.returning();

	if (!article) {
		throw new Error("Help article could not be created");
	}

	return article;
}

export async function updateHelpArticle(
	id: string,
	input: HelpArticleInput,
	db: Database = getDb(),
): Promise<HelpArticle> {
	await assertSlugAvailable(input.slug, db, id);

	const [article] = await db
		.update(helpArticle)
		.set({
			...input,
			updatedAt: new Date(),
		})
		.where(eq(helpArticle.id, id))
		.returning();

	if (!article) {
		throw new Error("Help article not found");
	}

	return article;
}

export async function deleteHelpArticle(
	id: string,
	db: Database = getDb(),
): Promise<void> {
	await db.delete(helpArticle).where(eq(helpArticle.id, id));
}
