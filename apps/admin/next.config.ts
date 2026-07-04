import type { NextConfig } from "next";

// Operator-facing dashboard: every page is session-gated and reads live data,
// so this app stays on dynamic rendering (no cacheComponents/PPR).
const nextConfig: NextConfig = {
	transpilePackages: [
		"@workspace/ui",
		"@workspace/auth",
		"@workspace/core",
		"@workspace/db",
		"@workspace/emails",
	],
};

export default nextConfig;
