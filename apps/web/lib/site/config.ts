const DEFAULT_URL = "https://alojamentoideal.pt";

/**
 * Canonical site metadata shared by the root layout, robots, sitemap and
 * manifest. `url` is a build-time constant (NEXT_PUBLIC_* is inlined), so it is
 * safe to use inside statically generated metadata routes.
 */
export const siteConfig = {
	name: "Alojamento Ideal",
	supportEmail: "support@alojamentoideal.pt",
	title: "Find Your Ideal Stay | Alojamento Ideal",
	description:
		"Cozy, thoughtfully designed apartments along Portugal's North Coast in Porto, Póvoa de Varzim, Leça da Palmeira and Canidelo. Comfortable, modern and full of local charm.",
	keywords: [
		"Alojamento Ideal",
		"apartments in Porto",
		"stays in Póvoa de Varzim",
		"Leça da Palmeira rentals",
		"Canidelo apartments",
		"Northern Portugal stays",
		"cozy apartments Portugal",
	],
	url: (process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_URL).replace(/\/+$/, ""),
} as const;
