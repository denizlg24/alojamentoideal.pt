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
	if (!body || typeof body !== "object") {
		return null;
	}
	const record = body as Record<string, unknown>;
	const socketId = record.socket_id ?? record.socketId;
	const channelName = record.channel_name ?? record.channelName;
	const reference = record.reference;
	if (
		typeof socketId !== "string" ||
		socketId.trim().length === 0 ||
		typeof channelName !== "string" ||
		channelName.trim().length === 0 ||
		typeof reference !== "string" ||
		reference.trim().length === 0
	) {
		return null;
	}
	return {
		channelName: channelName.trim(),
		reference: reference.trim(),
		socketId: socketId.trim(),
	};
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

		const accessContext = await resolveOrderAccessContext(request);
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
