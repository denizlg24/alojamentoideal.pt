import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site/config";

/**
 * Static routes that currently resolve. Add entries here as public pages ship
 * (/homes, /activities, /about, /faq, /help, /owner, /legal/*) and append
 * dynamic listing URLs from the catalog once detail pages exist. Avoid listing
 * routes that 404, since that harms crawl trust.
 */
const STATIC_ROUTES: ReadonlyArray<{
	changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
	path: string;
	priority: number;
}> = [{ changeFrequency: "daily", path: "/", priority: 1 }];

export default function sitemap(): MetadataRoute.Sitemap {
	const lastModified = new Date();

	return STATIC_ROUTES.map((route) => ({
		url: `${siteConfig.url}${route.path}`,
		lastModified,
		changeFrequency: route.changeFrequency,
		priority: route.priority,
	}));
}
