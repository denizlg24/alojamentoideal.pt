import { withApiRoute } from "@/lib/api/route";
import { getServerUser } from "@/lib/auth/session";

export const GET = withApiRoute(
	{ name: "me", rateLimit: { bucket: "auth" } },
	async (request: Request): Promise<Response> => {
		const user = await getServerUser(request);

		if (!user) {
			return new Response(null, { status: 401 });
		}

		return Response.json(user);
	},
);
