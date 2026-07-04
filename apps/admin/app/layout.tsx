import "@workspace/ui/globals.css";
import { Toaster } from "@workspace/ui/components/sonner";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk } from "next/font/google";

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
	title: {
		default: "Alojamento Ideal Admin",
		template: "%s | Alojamento Ideal Admin",
	},
	description: "Operations dashboard for Alojamento Ideal.",
	robots: { index: false, follow: false },
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`${fontSans.variable} ${fontDisplay.variable} font-sans antialiased`}
			>
				{children}
				<Toaster richColors position="bottom-right" />
			</body>
		</html>
	);
}
