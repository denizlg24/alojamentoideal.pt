import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/legal/legal-page";
import {
	LEGAL_PAGE_ORDER,
	LEGAL_PAGES,
	LEGAL_UPDATED_ON,
	type LegalSlug,
} from "@/lib/site/legal";

export function generateStaticParams() {
	return LEGAL_PAGE_ORDER.map((slug) => ({ slug }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const page = LEGAL_PAGES[slug as LegalSlug];

	if (!page) return {};

	return {
		title: page.title,
		description: page.description,
		alternates: { canonical: `/legal/${slug}` },
		openGraph: {
			type: "article",
			title: page.title,
			description: page.description,
			url: `/legal/${slug}`,
		},
		other: { "last-modified": LEGAL_UPDATED_ON },
	};
}

export default async function LegalRoute({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const page = LEGAL_PAGES[slug as LegalSlug];

	if (!page) notFound();

	return <LegalPage page={page} />;
}
