"use server";

import {
	createHelpArticle,
	deleteHelpArticle,
	type HelpArticleInput,
	HelpArticleSlugConflictError,
	helpArticleInputSchema,
	updateHelpArticle,
} from "@workspace/core/help";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/auth/admin";

function articleErrorRedirect(path: string, message: string): never {
	redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function parseArticleForm(formData: FormData): HelpArticleInput {
	const sortOrderRaw = String(formData.get("sortOrder") ?? "").trim();
	if (!/^\d+$/.test(sortOrderRaw)) {
		throw new Error("Sort order must be a whole number");
	}

	const parsed = helpArticleInputSchema.safeParse({
		contentMd: String(formData.get("contentMd") ?? ""),
		excerpt: String(formData.get("excerpt") ?? ""),
		published: formData.get("published") === "on",
		slug: String(formData.get("slug") ?? ""),
		sortOrder: Number(sortOrderRaw),
		title: String(formData.get("title") ?? ""),
	});

	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new Error(
			issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid article",
		);
	}

	return parsed.data;
}

export async function createHelpArticleAction(
	formData: FormData,
): Promise<void> {
	await requireAdminUser();

	try {
		await createHelpArticle(parseArticleForm(formData));
	} catch (error) {
		articleErrorRedirect(
			"/help-articles/new",
			error instanceof HelpArticleSlugConflictError
				? "That slug is already in use. Pick another one."
				: error instanceof Error
					? error.message
					: "The article could not be created.",
		);
	}

	revalidatePath("/help-articles");
	redirect("/help-articles?saved=created");
}

export async function updateHelpArticleAction(
	formData: FormData,
): Promise<void> {
	await requireAdminUser();

	const id = String(formData.get("id") ?? "");
	if (!id) {
		articleErrorRedirect("/help-articles", "Missing article id.");
	}

	try {
		await updateHelpArticle(id, parseArticleForm(formData));
	} catch (error) {
		articleErrorRedirect(
			`/help-articles/${id}`,
			error instanceof HelpArticleSlugConflictError
				? "That slug is already in use. Pick another one."
				: error instanceof Error
					? error.message
					: "The article could not be saved.",
		);
	}

	revalidatePath("/help-articles");
	redirect("/help-articles?saved=updated");
}

export async function deleteHelpArticleAction(
	formData: FormData,
): Promise<void> {
	await requireAdminUser();

	const id = String(formData.get("id") ?? "");
	if (!id) {
		articleErrorRedirect("/help-articles", "Missing article id.");
	}

	await deleteHelpArticle(id);

	revalidatePath("/help-articles");
	redirect("/help-articles?saved=deleted");
}
