import type { Metadata } from "next";
import { siteConfig } from "./config";

export const defaultOpenGraphImage = {
	alt: "Alojamento Ideal stays along Portugal's North Coast",
	height: 720,
	url: "/river2-poster.jpg",
	width: 1280,
} as const;

interface PageMetadataOptions {
	description: string;
	image?: string | null;
	keywords?: readonly string[];
	path: `/${string}`;
	title: string;
}

export function buildPageMetadata({
	description,
	image,
	keywords,
	path,
	title,
}: PageMetadataOptions): Metadata {
	const images = image ? [{ alt: title, url: image }] : [defaultOpenGraphImage];

	return {
		title,
		description,
		keywords: keywords ? [...keywords] : undefined,
		alternates: { canonical: path },
		openGraph: {
			type: "website",
			siteName: siteConfig.name,
			title,
			description,
			url: path,
			locale: "en",
			images,
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
			images,
		},
	};
}

export function buildPrivatePageMetadata({
	description,
	title,
}: {
	description: string;
	title: string;
}): Metadata {
	return {
		title,
		description,
		robots: {
			index: false,
			follow: false,
			nocache: true,
			googleBot: {
				index: false,
				follow: false,
				nocache: true,
			},
		},
	};
}

export function truncateMetaDescription(
	value: string,
	fallback: string,
): string {
	const normalized = value.replace(/\s+/g, " ").trim() || fallback;
	if (normalized.length <= 155) {
		return normalized;
	}
	return `${normalized.slice(0, 152).trimEnd()}...`;
}
