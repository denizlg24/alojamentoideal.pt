import { pingRedis } from "@workspace/core/redis";
import { withApiRoute } from "@/lib/api";

export const GET = withApiRoute(
	{ analytics: false, name: "health", rateLimit: false },
	async (): Promise<Response> => {
		const redisOk = await pingRedis();

		return Response.json({
			dependencies: { redis: redisOk ? "ok" : "unavailable" },
			service: "web",
			status: "ok",
		} as const);
	},
);
