import "@workspace/ui/globals.css";
import { getAuthConfig } from "@workspace/auth";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk } from "next/font/google";
import { AuthDialogProvider } from "@/components/auth/auth-dialog-provider";
import { siteConfig } from "@/lib/site/config";

const fontSans = Hanken_Grotesk({
	subsets: ["latin"],
	variable: "--font-sans",
	display: "swap",
});

const fontDisplay = Bricolage_Grotesque({
	subsets: ["latin"],
	variable: "--font-display",
	display: "swap",
});

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
	// Read server-only auth config once and pass the capability flag down; the
	// client overlay cannot inspect env vars. `children` stays a Server Component
	// passed as a prop, so wrapping it in a client provider does not deopt page
	// prerendering.
	const googleEnabled = Boolean(getAuthConfig().google);

	return (
		<html lang="en" className={`${fontSans.variable} ${fontDisplay.variable}`}>
			<body>
				<AuthDialogProvider googleEnabled={googleEnabled}>
					{children}
				</AuthDialogProvider>
			</body>
		</html>
	);
}
