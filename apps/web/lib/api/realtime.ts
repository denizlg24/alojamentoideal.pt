import "server-only";

import {
	conversationChannelName,
	noopRealtimePublisher,
	parseConversationChannelName,
	type RealtimePublisher,
} from "@workspace/core/commerce";
import Pusher from "pusher";

interface PusherServerConfig {
	appId: string;
	cluster: string;
	key: string;
	secret: string;
}

let pusherClient: Pusher | null | undefined;

function readPusherServerConfig(): PusherServerConfig | null {
	const appId = process.env.PUSHER_APP_ID;
	const key = process.env.PUSHER_KEY;
	const secret = process.env.PUSHER_SECRET;
	const cluster = process.env.PUSHER_CLUSTER;
	if (!appId || !key || !secret || !cluster) {
		return null;
	}
	return { appId, cluster, key, secret };
}

export function getPusherServerClient(): Pusher | null {
	if (pusherClient !== undefined) {
		return pusherClient;
	}

	const config = readPusherServerConfig();
	pusherClient = config
		? new Pusher({
				appId: config.appId,
				cluster: config.cluster,
				key: config.key,
				secret: config.secret,
				useTLS: true,
			})
		: null;
	return pusherClient;
}

export function requirePusherServerClient(): Pusher {
	const client = getPusherServerClient();
	if (!client) {
		throw new Error("Pusher is not configured.");
	}
	return client;
}

export function createPusherRealtimePublisher(): RealtimePublisher {
	const client = getPusherServerClient();
	if (!client) {
		return noopRealtimePublisher;
	}

	return {
		async publishConversationUpdated(orderId, conversationId, conversation) {
			await client.trigger(
				conversationChannelName(orderId, conversationId),
				"conversation.updated",
				{ conversation },
			);
		},
		async publishMessageCreated(orderId, conversationId, message, options) {
			await client.trigger(
				conversationChannelName(orderId, conversationId),
				"message.created",
				{ message },
				options?.excludeSocketId
					? { socket_id: options.excludeSocketId }
					: undefined,
			);
		},
	};
}

export { parseConversationChannelName };
