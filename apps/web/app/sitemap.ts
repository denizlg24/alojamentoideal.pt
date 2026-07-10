import type { MetadataRoute } from "next";
import { generateListingStaticParams } from "@/lib/catalog/listing-route";
import { siteConfig } from "@/lib/site/config";
import { LEGAL_PAGE_ORDER } from "@/lib/site/legal";

/**
 * Static public routes that currently resolve. Add entries here as more public
 * pages ship (/activities, /about, /faq, /help, /owner, /legal/*). Avoid listing
 * private checkout/order/account routes or public routes that still 404.
 */
const STATIC_ROUTES: ReadonlyArray<{
	changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
	path: string;
	priority: number;
}> = [
	{ changeFrequency: "daily", path: "/", priority: 1 },
	{ changeFrequency: "daily", path: "/homes", priority: 0.9 },
	{ changeFrequency: "monthly", path: "/about", priority: 0.6 },
	{ changeFrequency: "monthly", path: "/owner", priority: 0.6 },
	...LEGAL_PAGE_ORDER.map((slug) => ({
		changeFrequency: "yearly" as const,
		path: `/legal/${slug}`,
		priority: 0.3,
	})),
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const lastModified = new Date();
	const listingRoutes = (await generateListingStaticParams())
		.filter(({ id }) => id !== "__ci_placeholder__")
		.map(({ id }) => ({
			url: `${siteConfig.url}/homes/${encodeURIComponent(id)}`,
			lastModified,
			changeFrequency: "weekly" as const,
			priority: 0.7,
		}));

	return [
		...STATIC_ROUTES.map((route) => ({
			url: `${siteConfig.url}${route.path}`,
			lastModified,
			changeFrequency: route.changeFrequency,
			priority: route.priority,
		})),
		...listingRoutes,
	];
}
