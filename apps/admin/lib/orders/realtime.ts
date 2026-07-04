"use client";

import type {
	ConversationMessageDto,
	ConversationSummary,
} from "@workspace/core/commerce";
import Pusher, {
	type Channel,
	type ChannelAuthorizationCallback,
	type ChannelAuthorizationHandler,
} from "pusher-js";
import { type RefObject, useEffect, useRef } from "react";

type ChannelAuthorizationData = NonNullable<
	Parameters<ChannelAuthorizationCallback>[1]
>;

const channelReferences = new Map<string, Map<string, number>>();
const channelSubscriberCounts = new Map<string, number>();

let pusherClient: Pusher | null = null;
let realtimeSubscriberCount = 0;

function retainChannelReference(channelName: string, reference: string): void {
	let references = channelReferences.get(channelName);
	if (!references) {
		references = new Map();
		channelReferences.set(channelName, references);
	}
	references.set(reference, (references.get(reference) ?? 0) + 1);
}

function releaseChannelReference(channelName: string, reference: string): void {
	const references = channelReferences.get(channelName);
	if (!references) {
		return;
	}
	const nextCount = (references.get(reference) ?? 0) - 1;
	if (nextCount > 0) {
		references.set(reference, nextCount);
		return;
	}
	references.delete(reference);
	if (references.size === 0) {
		channelReferences.delete(channelName);
	}
}

function readChannelReference(channelName: string): string | null {
	return channelReferences.get(channelName)?.keys().next().value ?? null;
}

function isChannelAuthorizationData(
	value: unknown,
): value is ChannelAuthorizationData {
	return Boolean(
		value &&
			typeof value === "object" &&
			"auth" in value &&
			typeof value.auth === "string",
	);
}

const authorizeAdminOrderChannel: ChannelAuthorizationHandler = async (
	params,
	callback,
) => {
	const reference = readChannelReference(params.channelName);
	if (!reference) {
		callback(new Error("Missing order reference for realtime auth."), null);
		return;
	}

	try {
		const response = await fetch("/api/admin/realtime/auth", {
			body: new URLSearchParams({
				channel_name: params.channelName,
				reference,
				socket_id: params.socketId,
			}).toString(),
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			method: "POST",
		});
		if (!response.ok) {
			callback(
				new Error(
					`Unable to authorize realtime channel: received ${response.status}.`,
				),
				null,
			);
			return;
		}
		const data: unknown = await response.json();
		if (!isChannelAuthorizationData(data)) {
			callback(new Error("Invalid realtime auth response."), null);
			return;
		}
		callback(null, data);
	} catch (error) {
		callback(
			error instanceof Error
				? error
				: new Error("Unable to authorize realtime channel."),
			null,
		);
	}
};

function getPusherClient(): Pusher | null {
	if (pusherClient) {
		return pusherClient;
	}

	const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
	const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
	if (!key || !cluster) {
		return null;
	}

	pusherClient = new Pusher(key, {
		channelAuthorization: {
			customHandler: authorizeAdminOrderChannel,
		},
		cluster,
	});
	return pusherClient;
}

function acquirePusherClient(): Pusher | null {
	const client = getPusherClient();
	if (!client) {
		return null;
	}
	realtimeSubscriberCount += 1;
	return client;
}

function releasePusherClient(): void {
	realtimeSubscriberCount = Math.max(0, realtimeSubscriberCount - 1);
	if (realtimeSubscriberCount > 0 || !pusherClient) {
		return;
	}
	pusherClient.disconnect();
	pusherClient = null;
	channelSubscriberCounts.clear();
	channelReferences.clear();
}

function acquireChannel(
	pusher: Pusher,
	channelName: string,
	reference: string,
): Channel {
	retainChannelReference(channelName, reference);
	const subscriberCount = channelSubscriberCounts.get(channelName) ?? 0;
	channelSubscriberCounts.set(channelName, subscriberCount + 1);
	if (subscriberCount === 0) {
		return pusher.subscribe(channelName);
	}
	return pusher.channel(channelName) ?? pusher.subscribe(channelName);
}

function releaseChannel(
	pusher: Pusher,
	channelName: string,
	reference: string,
): void {
	const subscriberCount = channelSubscriberCounts.get(channelName) ?? 0;
	if (subscriberCount <= 1) {
		channelSubscriberCounts.delete(channelName);
		pusher.unsubscribe(channelName);
	} else {
		channelSubscriberCounts.set(channelName, subscriberCount - 1);
	}
	releaseChannelReference(channelName, reference);
}

interface UseAdminOrderConversationOptions {
	channelName: string | null;
	enabled?: boolean;
	onConversation?: (conversation: ConversationSummary) => void;
	onMessage: (message: ConversationMessageDto) => void;
	reference: string;
}

export interface UseAdminOrderConversationResult {
	socketIdRef: RefObject<string | null>;
}

export function useAdminOrderConversation({
	channelName,
	enabled = true,
	onConversation,
	onMessage,
	reference,
}: UseAdminOrderConversationOptions): UseAdminOrderConversationResult {
	const onMessageRef = useRef(onMessage);
	const onConversationRef = useRef(onConversation);
	const socketIdRef = useRef<string | null>(null);
	onMessageRef.current = onMessage;
	onConversationRef.current = onConversation;

	useEffect(() => {
		if (!enabled || !channelName) {
			return;
		}
		const pusher = acquirePusherClient();
		if (!pusher) {
			return;
		}

		const channel = acquireChannel(pusher, channelName, reference);
		socketIdRef.current = pusher.connection.socket_id || null;
		const handleConnected = () => {
			socketIdRef.current = pusher.connection.socket_id || null;
		};
		const handleDisconnected = () => {
			socketIdRef.current = null;
		};
		const handleMessage = (data: { message: ConversationMessageDto }) => {
			onMessageRef.current(data.message);
		};
		const handleConversation = (data: {
			conversation: ConversationSummary;
		}) => {
			onConversationRef.current?.(data.conversation);
		};

		pusher.connection.bind("connected", handleConnected);
		pusher.connection.bind("disconnected", handleDisconnected);
		channel.bind("message.created", handleMessage);
		channel.bind("conversation.updated", handleConversation);

		return () => {
			channel.unbind("message.created", handleMessage);
			channel.unbind("conversation.updated", handleConversation);
			pusher.connection.unbind("connected", handleConnected);
			pusher.connection.unbind("disconnected", handleDisconnected);
			releaseChannel(pusher, channelName, reference);
			releasePusherClient();
			socketIdRef.current = null;
		};
	}, [channelName, enabled, reference]);

	return { socketIdRef };
}
