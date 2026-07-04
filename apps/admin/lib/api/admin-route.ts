import type { AuthUser } from "@workspace/auth";
import { getAdminUser } from "../auth/admin";
import { type ApiRouteOptions, withApiRoute } from "./route";

export type AdminRouteHandler<Ctx> = (
	request: Request,
	context: Ctx,
	admin: AuthUser,
) => Promise<Response> | Response;

/**
 * Admin-gated route wrapper: resolves the caller and rejects non-admins with
 * 404 (existence of admin endpoints is not advertised to guests), then
 * delegates to {@link withApiRoute} for rate limiting and observability.
 */
export function withAdminRoute<Ctx = unknown>(
	options: ApiRouteOptions,
	handler: AdminRouteHandler<Ctx>,
): (request: Request, context: Ctx) => Promise<Response> {
	return withApiRoute<Ctx>(options, async (request, context) => {
		const admin = await getAdminUser(request);
		if (!admin) {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
		return handler(request, context, admin);
	});
}

/** Parses a JSON request body, returning `null` on absent or invalid JSON. */
export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}
