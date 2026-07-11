import { getHelpArticleById } from "@workspace/core/help";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteHelpArticleAction, updateHelpArticleAction } from "../actions";
import { ArticleForm } from "../article-form";

export const metadata: Metadata = { title: "Edit help article" };

export default async function EditHelpArticlePage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ error?: string }>;
}) {
	const [{ id }, query] = await Promise.all([params, searchParams]);
	const article = await getHelpArticleById(id);

	if (!article) notFound();

	return (
		<div className="mx-auto max-w-6xl">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="font-display font-semibold text-xl tracking-tight">
						Edit help article
					</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						{article.published ? (
							<>
								Live at{" "}
								<Link
									className="underline underline-offset-4"
									href={`https://alojamentoideal.pt/help/${article.slug}`}
									rel="noreferrer"
									target="_blank"
								>
									/help/{article.slug}
								</Link>
							</>
						) : (
							"This article is a draft and is not visible to guests."
						)}
					</p>
				</div>

				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button variant="destructive">Delete article</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete this article?</AlertDialogTitle>
							<AlertDialogDescription>
								&quot;{article.title}&quot; will be removed permanently and its
								public URL will stop working. This cannot be undone.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<form action={deleteHelpArticleAction}>
								<input name="id" type="hidden" value={article.id} />
								<AlertDialogAction type="submit">Delete</AlertDialogAction>
							</form>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>

			{query.error ? (
				<p className="mt-4 text-red-600 text-sm dark:text-red-400">
					{query.error}
				</p>
			) : null}

			<ArticleForm
				action={updateHelpArticleAction}
				article={article}
				submitLabel="Save changes"
			/>
		</div>
	);
}
