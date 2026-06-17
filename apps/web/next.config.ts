import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	transpilePackages: ["@workspace/ui", "@workspace/auth"],
};

export default nextConfig;
