import {
	commerceErrorResponse,
	commerceService,
	readCartToken,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { getServerUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Merges the anonymous cart referenced by the `ai_cart` cookie into the
 * authenticated user. Idempotent and safe to call after every login; the
 * session-create hook does the same merge opportunistically.
 */
export const POST = withApiRoute(
	{ name: "cart.claim", rateLimit: { bucket: "cart.write" } },
	async (request: Request): Promise<Response> => {
		const user = await getServerUser(request);
		if (!user) {
			return new Response(null, { status: 401 });
		}

		const cartToken = readCartToken(request);
		if (!cartToken) {
			return new Response(null, { status: 204 });
		}

		try {
			return Response.json(
				await commerceService().claimCart(
					{ cartToken, userId: user.id },
					cartToken,
				),
			);
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
