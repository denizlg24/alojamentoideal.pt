import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	transpilePackages: [
		"@workspace/ui",
		"@workspace/auth",
		"@workspace/core",
		"@workspace/db",
	],
};

export default nextConfig;
