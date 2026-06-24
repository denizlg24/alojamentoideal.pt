import type { AccountProfileInput } from "@workspace/core/account";
import { profileUpdateSchema } from "@/lib/account/validation";
import { accountProfileRepository } from "@/lib/api/account";
import { withApiRoute } from "@/lib/api/route";
import { getServerUser } from "@/lib/auth/session";

export const GET = withApiRoute(
	{ name: "account.profile.get", rateLimit: { bucket: "auth" } },
	async (request: Request): Promise<Response> => {
		const user = await getServerUser(request);
		if (!user) {
			return new Response(null, { status: 401 });
		}

		const profile = await accountProfileRepository().getProfile(user.id);
		return Response.json(profile);
	},
);

export const PUT = withApiRoute(
	{ name: "account.profile.update", rateLimit: { bucket: "auth" } },
	async (request: Request): Promise<Response> => {
		const user = await getServerUser(request);
		if (!user) {
			return new Response(null, { status: 401 });
		}

		const body = await request.json().catch(() => null);
		const parsed = profileUpdateSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json(
				{
					code: "invalid_request",
					error: "Some details need attention",
					issues: parsed.error.issues.map((issue) => ({
						message: issue.message,
						path: issue.path.join("."),
					})),
				},
				{ status: 400 },
			);
		}

		// Compile-time guarantee the validated shape matches the domain input.
		const input: AccountProfileInput = parsed.data;
		const profile = await accountProfileRepository().updateProfile(
			user.id,
			input,
		);
		return Response.json(profile);
	},
);
