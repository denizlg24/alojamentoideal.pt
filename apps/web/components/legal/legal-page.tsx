import Link from "next/link";
import { SiteFooter } from "@/components/home/site-footer";
import { SiteHeader } from "@/components/home/site-header";
import {
	LEGAL_NAVIGATION,
	LEGAL_UPDATED_ON,
	type LegalPageDefinition,
} from "@/lib/site/legal";

export function LegalPage({ page }: { page: LegalPageDefinition }) {
	return (
		<div className="flex min-h-svh flex-col bg-muted/20">
			<SiteHeader solid />
			<main className="flex-1 pt-16">
				<div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[210px_minmax(0,760px)] lg:gap-14">
					<aside className="hidden lg:block">
						<nav aria-label="Legal pages" className="sticky top-24">
							<p className="mb-3 font-display font-semibold text-sm">Legal</p>
							<ul className="flex flex-col gap-1 border-l pl-4 text-sm">
								{LEGAL_NAVIGATION.map((item) => (
									<li key={item.href}>
										<Link
											className="block py-1 text-muted-foreground transition-colors hover:text-foreground"
											href={item.href}
										>
											{item.label}
										</Link>
									</li>
								))}
							</ul>
						</nav>
					</aside>

					<article className="min-w-0 rounded-3xl border bg-background px-5 py-7 shadow-sm sm:px-10 sm:py-10">
						<header className="border-b pb-8">
							<p className="mb-3 font-medium text-muted-foreground text-sm uppercase tracking-[0.14em]">
								Alojamento Ideal
							</p>
							<h1 className="font-display text-4xl tracking-tight sm:text-5xl">
								{page.title}
							</h1>
							<p className="mt-4 max-w-2xl text-base text-muted-foreground leading-7">
								{page.intro}
							</p>
							<p className="mt-5 text-muted-foreground text-xs">
								Last updated {LEGAL_UPDATED_ON}
							</p>
						</header>

						<div className="divide-y">
							{page.sections.map((section) => (
								<section
									className="py-7 first:pt-8 last:pb-0"
									key={section.title}
								>
									<h2 className="font-display text-2xl tracking-tight">
										{section.title}
									</h2>
									<div className="mt-3 flex flex-col gap-3 text-[0.98rem] text-muted-foreground leading-7">
										{section.paragraphs.map((paragraph) => (
											<p key={paragraph}>{paragraph}</p>
										))}
										{section.bullets && (
											<ul className="list-disc space-y-2 pl-5 marker:text-foreground/40">
												{section.bullets.map((bullet) => (
													<li key={bullet}>{bullet}</li>
												))}
											</ul>
										)}
									</div>
								</section>
							))}
						</div>

						<nav
							aria-label="More legal information"
							className="mt-10 border-t pt-6"
						>
							<p className="mb-3 font-medium text-sm">More legal information</p>
							<div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
								{LEGAL_NAVIGATION.map((item) => (
									<Link
										className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
										href={item.href}
										key={item.href}
									>
										{item.label}
									</Link>
								))}
							</div>
						</nav>
					</article>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
