"use client";

import type { HelpArticle } from "@workspace/core/help";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

export function ArticleForm({
	action,
	article,
	submitLabel,
}: {
	action: (formData: FormData) => Promise<void>;
	article?: HelpArticle;
	submitLabel: string;
}) {
	const [contentMd, setContentMd] = useState(article?.contentMd ?? "");

	return (
		<form action={action} className="mt-6 space-y-6">
			{article ? <input name="id" type="hidden" value={article.id} /> : null}

			<div className="grid gap-5 sm:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="title">Title</Label>
					<Input
						defaultValue={article?.title}
						id="title"
						maxLength={200}
						name="title"
						placeholder="How to make a reservation"
						required
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="slug">Slug</Label>
					<Input
						defaultValue={article?.slug}
						id="slug"
						maxLength={120}
						name="slug"
						pattern="[a-z0-9]+(-[a-z0-9]+)*"
						placeholder="how-to-make-a-reservation"
						required
						title="Lowercase letters, numbers and hyphens"
					/>
					<p className="text-muted-foreground text-xs">
						Public URL: /help/&lt;slug&gt;. Lowercase letters, numbers and
						hyphens.
					</p>
				</div>
			</div>

			<div className="space-y-2">
				<Label htmlFor="excerpt">Excerpt</Label>
				<Input
					defaultValue={article?.excerpt}
					id="excerpt"
					maxLength={300}
					name="excerpt"
					placeholder="A one or two sentence summary shown on the help page."
					required
				/>
			</div>

			<div className="grid gap-5 sm:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="sortOrder">Sort order</Label>
					<Input
						defaultValue={article?.sortOrder ?? 0}
						id="sortOrder"
						max={999}
						min={0}
						name="sortOrder"
						required
						type="number"
					/>
					<p className="text-muted-foreground text-xs">
						Lower numbers appear first on the help page.
					</p>
				</div>
				<div className="flex items-center gap-2 sm:mt-7">
					<input
						className="size-4 accent-primary"
						defaultChecked={article?.published ?? false}
						id="published"
						name="published"
						type="checkbox"
					/>
					<Label htmlFor="published">Published</Label>
				</div>
			</div>

			<div className="grid gap-5 lg:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="contentMd">Content (markdown)</Label>
					<Textarea
						className="min-h-[28rem] font-mono text-sm"
						id="contentMd"
						maxLength={20000}
						name="contentMd"
						onChange={(event) => setContentMd(event.target.value)}
						placeholder={"## A heading\n\nWrite the article in markdown."}
						required
						value={contentMd}
					/>
				</div>
				<div className="space-y-2">
					<Label>Preview</Label>
					<div className="prose prose-neutral dark:prose-invert min-h-[28rem] max-w-none rounded-md border bg-background px-4 py-3">
						{contentMd.trim() ? (
							<ReactMarkdown>{contentMd}</ReactMarkdown>
						) : (
							<p className="text-muted-foreground text-sm">
								The rendered article appears here as you type.
							</p>
						)}
					</div>
				</div>
			</div>

			<div className="flex justify-end">
				<Button type="submit">{submitLabel}</Button>
			</div>
		</form>
	);
}
