import { listHelpArticles } from "@workspace/core/help";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Help articles" };

const SAVED_MESSAGES: Record<string, string> = {
	created: "Article created.",
	deleted: "Article deleted.",
	updated: "Article saved.",
};

export default async function HelpArticlesPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string; saved?: string }>;
}) {
	const [articles, params] = await Promise.all([
		listHelpArticles(),
		searchParams,
	]);

	return (
		<div className="mx-auto max-w-6xl">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="font-display font-semibold text-xl tracking-tight">
						Help articles
					</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Guides shown on the public help page. Only published articles are
						visible to guests.
						<span className="ml-1">{articles.length} total</span>
					</p>
				</div>
				<Button asChild>
					<Link href="/help-articles/new">New article</Link>
				</Button>
			</div>

			{params.error ? (
				<p className="mt-4 text-red-600 text-sm dark:text-red-400">
					{params.error}
				</p>
			) : params.saved ? (
				<p className="mt-4 text-emerald-600 text-sm dark:text-emerald-400">
					{SAVED_MESSAGES[params.saved] ?? "Changes saved."}
				</p>
			) : null}

			<div className="mt-6 overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Title</TableHead>
							<TableHead>Slug</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Sort</TableHead>
							<TableHead>Updated</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{articles.length === 0 ? (
							<TableRow>
								<TableCell
									className="py-12 text-center text-muted-foreground"
									colSpan={5}
								>
									No help articles yet. Create the first one.
								</TableCell>
							</TableRow>
						) : (
							articles.map((article) => (
								<TableRow key={article.id}>
									<TableCell className="min-w-52 align-top">
										<Link
											className="font-medium hover:underline"
											href={`/help-articles/${article.id}`}
										>
											{article.title}
										</Link>
										<p className="mt-1 max-w-md truncate text-muted-foreground text-sm">
											{article.excerpt}
										</p>
									</TableCell>
									<TableCell className="whitespace-nowrap align-top text-muted-foreground text-sm">
										{article.slug}
									</TableCell>
									<TableCell className="align-top">
										{article.published ? (
											<Badge>Published</Badge>
										) : (
											<Badge variant="secondary">Draft</Badge>
										)}
									</TableCell>
									<TableCell className="align-top text-muted-foreground text-sm">
										{article.sortOrder}
									</TableCell>
									<TableCell className="whitespace-nowrap align-top text-muted-foreground text-sm">
										{formatDateTime(article.updatedAt)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
