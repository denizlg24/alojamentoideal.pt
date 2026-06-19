import "@workspace/ui/globals.css";
import type { Metadata, Viewport } from "next";
import { siteConfig } from "@/lib/site/config";

export const metadata: Metadata = {
	metadataBase: new URL(siteConfig.url),
	title: {
		default: siteConfig.title,
		template: `%s | ${siteConfig.name}`,
	},
	description: siteConfig.description,
	keywords: [...siteConfig.keywords],
	applicationName: siteConfig.name,
	alternates: { canonical: "/" },
	openGraph: {
		type: "website",
		siteName: siteConfig.name,
		title: siteConfig.title,
		description: siteConfig.description,
		url: siteConfig.url,
		locale: "en",
	},
	twitter: {
		card: "summary_large_image",
		title: siteConfig.title,
		description: siteConfig.description,
	},
	icons: {
		icon: [
			{ url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
			{ url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
		],
		apple: [
			{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
		],
	},
	robots: { index: true, follow: true },
};

export const viewport: Viewport = {
	themeColor: "#ffffff",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
