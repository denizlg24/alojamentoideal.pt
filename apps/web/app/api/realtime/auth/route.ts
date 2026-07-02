import { z } from "zod";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import {
	parseConversationChannelName,
	requirePusherServerClient,
} from "@/lib/api/realtime";
import { withApiRoute } from "@/lib/api/route";

interface RealtimeAuthBody {
	channelName: string;
	reference: string;
	socketId: string;
}

const realtimeAuthBodySchema = z
	.object({
		channel_name: z.string().optional(),
		channelName: z.string().optional(),
		reference: z.string(),
		socket_id: z.string().optional(),
		socketId: z.string().optional(),
	})
	.transform((body, context) => {
		const channelName = body.channel_name ?? body.channelName;
		const socketId = body.socket_id ?? body.socketId;
		if (!channelName || channelName.trim().length === 0) {
			context.addIssue({
				code: "custom",
				message: "Channel name is required.",
				path: ["channelName"],
			});
			return z.NEVER;
		}
		if (!socketId || socketId.trim().length === 0) {
			context.addIssue({
				code: "custom",
				message: "Socket id is required.",
				path: ["socketId"],
			});
			return z.NEVER;
		}
		if (body.reference.trim().length === 0) {
			context.addIssue({
				code: "custom",
				message: "Reference is required.",
				path: ["reference"],
			});
			return z.NEVER;
		}
		return {
			channelName: channelName.trim(),
			reference: body.reference.trim(),
			socketId: socketId.trim(),
		};
	});

async function readRealtimeAuthRequest(
	request: Request,
): Promise<RealtimeAuthBody | null> {
	const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
	if (
		contentType.includes("application/x-www-form-urlencoded") ||
		contentType.includes("multipart/form-data")
	) {
		const formData = await request.formData();
		return readRealtimeAuthBody({
			channel_name: formData.get("channel_name"),
			channelName: formData.get("channelName"),
			reference: formData.get("reference"),
			socket_id: formData.get("socket_id"),
			socketId: formData.get("socketId"),
		});
	}

	return readRealtimeAuthBody(await readJson(request));
}

function readRealtimeAuthBody(body: unknown): RealtimeAuthBody | null {
	const parsed = realtimeAuthBodySchema.safeParse(body);
	return parsed.success ? parsed.data : null;
}

export const POST = withApiRoute(
	{ name: "realtime.auth", rateLimit: { bucket: "mutation" } },
	async (request: Request): Promise<Response> => {
		const body = await readRealtimeAuthRequest(request);
		if (!body) {
			return Response.json(
				{ code: "invalid_request", error: "Invalid realtime auth request." },
				{ status: 400 },
			);
		}

		const parsedChannel = parseConversationChannelName(body.channelName);
		if (!parsedChannel) {
			return Response.json(
				{ code: "invalid_request", error: "Invalid realtime channel." },
				{ status: 400 },
			);
		}

		const accessContext = await resolveOrderAccessContext(
			request,
			body.reference,
		);
		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(
				body.reference,
				accessContext,
			);
			if (access.order.id !== parsedChannel.orderId) {
				return Response.json({ error: "Forbidden" }, { status: 403 });
			}
			const conversations = await service.readOrderConversations(access);
			if (
				!conversations.some(
					(conversation) => conversation.id === parsedChannel.conversationId,
				)
			) {
				return Response.json({ error: "Forbidden" }, { status: 403 });
			}

			const auth = requirePusherServerClient().authorizeChannel(
				body.socketId,
				body.channelName,
			);
			return Response.json(auth);
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			if (
				error instanceof Error &&
				error.message === "Pusher is not configured."
			) {
				return Response.json(
					{ error: "Realtime is not configured" },
					{ status: 503 },
				);
			}
			throw error;
		}
	},
);
