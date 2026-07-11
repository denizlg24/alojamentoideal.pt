import { z } from "zod";
import {
	accountBookmarkRepository,
	bookmarkScope,
} from "@/lib/account/bookmarks";
import { withApiRoute } from "@/lib/api/route";
import { getServerUser } from "@/lib/auth/session";

export const GET = withApiRoute(
	{ name: "account.bookmarks.list", rateLimit: { bucket: "auth" } },
	async (request: Request): Promise<Response> => {
		const user = await getServerUser(request);
		if (!user) {
			return new Response(null, { status: 401 });
		}

		const listingIds = await accountBookmarkRepository().listListingExternalIds(
			user.id,
			bookmarkScope(),
		);
		return Response.json({ listingIds });
	},
);

const toggleSchema = z.object({
	listingId: z.string().trim().min(1).max(120),
	saved: z.boolean(),
});

export const POST = withApiRoute(
	{ name: "account.bookmarks.toggle", rateLimit: { bucket: "mutation" } },
	async (request: Request): Promise<Response> => {
		const user = await getServerUser(request);
		if (!user) {
			return new Response(null, { status: 401 });
		}

		const parsed = toggleSchema.safeParse(
			await request.json().catch(() => null),
		);
		if (!parsed.success) {
			return Response.json(
				{ code: "invalid_request", error: "Invalid bookmark request." },
				{ status: 400 },
			);
		}

		const { listingId, saved } = parsed.data;
		const repository = accountBookmarkRepository();
		const scope = bookmarkScope();
		if (saved) {
			await repository.add(user.id, scope, listingId);
		} else {
			await repository.remove(user.id, scope, listingId);
		}
		return Response.json({ listingId, saved });
	},
);
