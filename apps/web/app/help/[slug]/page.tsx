import { getPublishedHelpArticleBySlug } from "@workspace/core/help";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import ReactMarkdown from "react-markdown";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { buildPageMetadata } from "@/lib/site/metadata";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const article = await getPublishedHelpArticleBySlug(slug);

	if (!article) notFound();

	return buildPageMetadata({
		title: article.title,
		description: article.excerpt,
		path: `/help/${article.slug}`,
	});
}

async function HelpArticleContent({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const article = await getPublishedHelpArticleBySlug(slug);

	if (!article) notFound();

	return (
		<>
			<section className="mx-auto w-full max-w-3xl px-4 pt-28 pb-10 sm:px-6 lg:pt-36">
				<Link
					className="group inline-flex items-center gap-2 font-medium text-[#9b5c3d] text-sm"
					href="/help"
				>
					<ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
					All help guides
				</Link>
				<p className="mt-10 mb-5 flex items-center gap-2 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
					<span className="h-px w-8 bg-[#9b5c3d]" />
					Help guide
				</p>
				<h1 className="font-display text-4xl leading-[0.95] tracking-[-0.05em] sm:text-6xl">
					{article.title}
				</h1>
				<p className="mt-6 max-w-xl text-[#665d55] text-lg leading-relaxed">
					{article.excerpt}
				</p>
			</section>

			<section className="mx-auto w-full max-w-3xl px-4 pb-20 sm:px-6 lg:pb-28">
				<article className="prose prose-neutral max-w-none border-[#e6dbcf] border-t pt-10 prose-headings:font-display prose-headings:font-normal prose-a:text-[#9b5c3d] prose-strong:text-[#2e2925] text-[#4a423b] prose-headings:tracking-[-0.02em]">
					<ReactMarkdown>{article.contentMd}</ReactMarkdown>
				</article>
			</section>
		</>
	);
}

function HelpArticleSkeleton() {
	return (
		<section className="mx-auto w-full max-w-3xl px-4 pt-28 pb-20 sm:px-6 lg:pt-36">
			<div className="h-5 w-32 animate-pulse rounded-full bg-[#ece5da]" />
			<div className="mt-12 h-14 max-w-lg animate-pulse rounded-xl bg-[#ece5da]" />
			<div className="mt-8 space-y-3">
				{["a", "b", "c", "d"].map((key) => (
					<div
						className="h-4 animate-pulse rounded-full bg-[#ece5da]"
						key={key}
					/>
				))}
			</div>
		</section>
	);
}

export default function HelpArticlePage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	return (
		<div className="min-h-screen bg-[#f8f5ef] text-[#2e2925]">
			<SiteHeader solid />

			<main>
				<Suspense fallback={<HelpArticleSkeleton />}>
					<HelpArticleContent params={params} />
				</Suspense>

				<section className="border-[#e6dbcf] border-t bg-[#f1ebe2]">
					<div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between">
						<div>
							<h2 className="font-display text-3xl leading-none tracking-[-0.04em]">
								Did this answer your question?
							</h2>
							<p className="mt-3 max-w-sm text-[#665d55] text-sm leading-relaxed">
								If not, send us a message. A real person from our team will
								reply.
							</p>
						</div>
						<Link
							className="group inline-flex items-center gap-3 rounded-full bg-[#9b5c3d] px-6 py-3.5 font-medium text-sm text-white transition hover:bg-[#7f472f]"
							href="/help#contact"
						>
							Contact us
							<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
						</Link>
					</div>
				</section>
			</main>

			<SiteFooter />
		</div>
	);
}
