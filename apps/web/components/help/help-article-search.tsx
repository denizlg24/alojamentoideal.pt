"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export interface HelpArticleSummary {
	slug: string;
	title: string;
	excerpt: string;
}

export function HelpArticleSearch({
	articles,
}: {
	articles: HelpArticleSummary[];
}) {
	const [query, setQuery] = useState("");

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return articles;
		return articles.filter(
			(article) =>
				article.title.toLowerCase().includes(needle) ||
				article.excerpt.toLowerCase().includes(needle),
		);
	}, [articles, query]);

	return (
		<div>
			<label className="relative block max-w-xl">
				<span className="sr-only">Search help articles</span>
				<Search className="absolute top-1/2 left-5 size-4 -translate-y-1/2 text-[#9d9389]" />
				<input
					className="w-full rounded-full border border-[#d8cbbd] bg-white/70 py-3.5 pr-5 pl-12 text-[#2e2925] outline-none transition placeholder:text-[#9d9389] focus:border-[#9b5c3d]"
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search guides, e.g. check-in"
					type="search"
					value={query}
				/>
			</label>

			{filtered.length === 0 ? (
				<div className="mt-10 rounded-2xl border border-[#e6dbcf] border-dashed px-6 py-14 text-center">
					<p className="font-display text-2xl">No guides match your search.</p>
					<p className="mt-2 text-[#665d55] text-sm">
						Try a different word, or send us a message below and we will help
						directly.
					</p>
				</div>
			) : (
				<div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{filtered.map((article, index) => (
						<Link
							className="group flex flex-col justify-between rounded-2xl border border-[#e6dbcf] bg-white/60 p-6 transition hover:border-[#9b5c3d]/50 hover:bg-white sm:p-7"
							href={`/help/${article.slug}`}
							key={article.slug}
						>
							<div>
								<p className="font-medium text-[#9b5c3d] text-[10px] uppercase tracking-[0.2em]">
									Guide 0{index + 1}
								</p>
								<h3 className="mt-3 font-display text-2xl leading-tight tracking-[-0.02em]">
									{article.title}
								</h3>
								<p className="mt-3 text-[#665d55] text-sm leading-relaxed">
									{article.excerpt}
								</p>
							</div>
							<span className="mt-8 inline-flex items-center gap-2 font-medium text-[#9b5c3d] text-sm">
								Read the guide
								<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
							</span>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
