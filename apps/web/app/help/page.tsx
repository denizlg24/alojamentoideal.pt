import { listPublishedHelpArticles } from "@workspace/core/help";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ContactForm } from "@/components/help/contact-form";
import { HelpArticleSearch } from "@/components/help/help-article-search";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import { buildPageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPageMetadata({
	title: "Help",
	description:
		"Guides for booking, checking in and getting the most out of your Alojamento Ideal stay, plus a direct line to our team.",
	path: "/help",
	keywords: [
		"Alojamento Ideal help",
		"contact Alojamento Ideal",
		"booking help Porto apartments",
		"check-in guide Portugal stay",
	],
});

async function HelpArticlesSection() {
	const articles = await listPublishedHelpArticles();

	return (
		<HelpArticleSearch
			articles={articles.map(({ excerpt, slug, title }) => ({
				excerpt,
				slug,
				title,
			}))}
		/>
	);
}

function HelpArticlesSkeleton() {
	return (
		<div>
			<div className="h-12 max-w-xl animate-pulse rounded-full bg-[#ece5da]" />
			<div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{["a", "b", "c"].map((key) => (
					<div
						className="h-56 animate-pulse rounded-2xl bg-[#ece5da]"
						key={key}
					/>
				))}
			</div>
		</div>
	);
}

export default function HelpPage() {
	return (
		<div className="min-h-screen bg-[#f8f5ef] text-[#2e2925]">
			<SiteHeader solid />

			<main>
				<section className="mx-auto w-full max-w-6xl px-4 pt-28 pb-14 sm:px-6 lg:pt-36 lg:pb-20">
					<p className="mb-5 flex items-center gap-2 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
						<span className="h-px w-8 bg-[#9b5c3d]" />
						Help center
					</p>
					<h1 className="max-w-3xl font-display text-[clamp(3rem,7vw,6.5rem)] leading-[0.88] tracking-[-0.06em]">
						Hello, how can
						<span className="text-[#9b5c3d]"> we help?</span>
					</h1>
					<p className="mt-7 max-w-xl text-[#665d55] text-lg leading-relaxed">
						Short, practical guides for every step of your stay. If a guide does
						not answer your question, message us directly below.
					</p>
				</section>

				<section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 lg:pb-28">
					<Suspense fallback={<HelpArticlesSkeleton />}>
						<HelpArticlesSection />
					</Suspense>
				</section>

				<section
					className="border-[#e6dbcf] border-t bg-[#f1ebe2]"
					id="contact"
				>
					<div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:py-28">
						<div>
							<p className="mb-4 font-medium text-[#9b5c3d] text-xs uppercase tracking-[0.22em]">
								Still need help?
							</p>
							<h2 className="font-display text-4xl leading-[0.95] tracking-[-0.05em] sm:text-5xl">
								Talk to the people who look after your stay.
							</h2>
							<p className="mt-6 max-w-md text-[#665d55] leading-relaxed">
								No call centers and no middle layers. Your message goes straight
								to our team in Northern Portugal, the same people who prepare
								the apartments and run the day to day.
							</p>
							<p className="mt-4 text-[#665d55] text-sm">
								Prefer email? Write to{" "}
								<a
									className="underline underline-offset-4"
									href="mailto:geral@alojamentoideal.pt"
								>
									geral@alojamentoideal.pt
								</a>
								.
							</p>
						</div>
						<ContactForm />
					</div>
				</section>
			</main>

			<SiteFooter />
		</div>
	);
}
