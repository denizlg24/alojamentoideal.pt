import type { Metadata } from "next";
import { createHelpArticleAction } from "../actions";
import { ArticleForm } from "../article-form";

export const metadata: Metadata = { title: "New help article" };

export default async function NewHelpArticlePage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const params = await searchParams;

	return (
		<div className="mx-auto max-w-6xl">
			<h1 className="font-display font-semibold text-xl tracking-tight">
				New help article
			</h1>
			<p className="mt-1 text-muted-foreground text-sm">
				Write the guide in markdown. It appears on the public help page once
				published.
			</p>

			{params.error ? (
				<p className="mt-4 text-red-600 text-sm dark:text-red-400">
					{params.error}
				</p>
			) : null}

			<ArticleForm
				action={createHelpArticleAction}
				submitLabel="Create article"
			/>
		</div>
	);
}
