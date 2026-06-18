import { getAuth } from "@workspace/auth";
import { withApiRoute } from "@/lib/api";

export const GET = withApiRoute(
	{ name: "me", rateLimit: { bucket: "auth" } },
	async (request: Request): Promise<Response> => {
		const session = await getAuth().api.getSession({
			headers: request.headers,
		});

		if (!session) {
			return new Response(null, { status: 401 });
		}

		return Response.json(session.user);
	},
);
