import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

function readPositiveInteger(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer`);
	}

	return parsed;
}

const nextConfig: NextConfig = {
	// Dynamic-by-default rendering; catalog reads opt into caching explicitly via
	// the `use cache` directive in `lib/catalog/cache.ts`, invalidated on-demand
	// by the Hostify sync cron through `revalidateTag`.
	cacheComponents: true,
	experimental: {
		// Page-data collection runs in worker processes. Catalog prerendering reads
		// Postgres, so keep build fanout aligned with the DB build pool cap.
		// cpus: readPositiveInteger("NEXT_BUILD_WORKERS", 2),
	},
	images: {
		// Listing/activity photos are served from the Hostify and Bokun CDNs.
		remotePatterns: [
			new URL("https://img.hostify.com/**"),
			new URL("https://bokun.s3.amazonaws.com/**"),
			new URL("http://bokundemo.s3.amazonaws.com/**"),
		],
	},
	transpilePackages: [
		"@workspace/ui",
		"@workspace/auth",
		"@workspace/core",
		"@workspace/db",
		"@workspace/emails",
	],
};

// Source-map upload is a no-op without SENTRY_AUTH_TOKEN, so this is safe to
// apply unconditionally; runtime error capture is gated by the DSN in the
// sentry.*.config files.
export default withSentryConfig(nextConfig, {
	authToken: process.env.SENTRY_AUTH_TOKEN,
	disableLogger: true,
	org: process.env.SENTRY_ORG,
	project: process.env.SENTRY_PROJECT,
	silent: !process.env.CI,
	widenClientFileUpload: true,
});
