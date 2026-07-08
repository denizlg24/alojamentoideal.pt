import type {
	ConversationMessageDeliveryStatus,
	ConversationMessageSenderType,
	ConversationStatus,
} from "@workspace/db";
import type {
	HostifyClient,
	HostifyId,
	HostifyMessage,
	HostifyRequestContext,
	HostifyThread,
} from "../integrations/hostify";

export type {
	ConversationMessageDeliveryStatus,
	ConversationMessageSenderType,
	ConversationStatus,
};

/**
 * Provider tag for conversations that live entirely in our own database and
 * realtime channel, with no external inbox behind them. Used for orders whose
 * bookings have no provider chat (e.g. activity-only orders): the conversation
 * is active from the moment it is provisioned and messages are delivered the
 * moment they are stored.
 */
export const INTERNAL_CONVERSATION_PROVIDER = "internal";

export interface ProviderConversationThread {
	externalThreadId: string;
	lastMessagePreview: string | null;
	raw: Record<string, unknown>;
	status: ConversationStatus;
	unreadCount: number;
}

export interface ProviderConversationMessage {
	body: string;
	externalMessageId: string;
	isAutomatic: boolean;
	raw: Record<string, unknown>;
	senderType: ConversationMessageSenderType;
	sentAt: Date;
}

export interface ProviderConversationSnapshot {
	messages: ProviderConversationMessage[];
	thread: ProviderConversationThread;
}

export interface ProviderConversationGateway {
	findThreadForReservation(
		reservationId: string,
	): Promise<ProviderConversationThread | null>;
	getThread(threadId: string): Promise<ProviderConversationSnapshot>;
	/**
	 * Delivers a guest-authored message into the provider thread. `channelMessageId`
	 * is our own message id, handed to the provider so the thread renders it as the
	 * guest (not the host) and so retries of the same message are idempotent on the
	 * provider side.
	 */
	sendMessage(
		threadId: string,
		body: string,
		channelMessageId: string,
	): Promise<string | null>;
	/** Delivers a host/operator reply into the provider thread. */
	sendHostReply(threadId: string, body: string): Promise<string | null>;
}

export interface ConversationSummary {
	externalThreadId: string | null;
	id: string;
	lastMessageAt: string | null;
	lastMessagePreview: string | null;
	provider: string;
	providerBookingId: string | null;
	status: ConversationStatus;
	unreadCount: number;
}

export interface ConversationMessageDto {
	body: string;
	conversationId: string;
	deliveryStatus: ConversationMessageDeliveryStatus;
	externalMessageId: string | null;
	id: string;
	isAutomatic: boolean;
	readAt: string | null;
	senderMemberId: string | null;
	senderType: ConversationMessageSenderType;
	sentAt: string;
}

export interface ReconcileConversationsSummary {
	failed: number;
	importedMessages: number;
	linked: number;
	provisioned: number;
	scanned: number;
	synced: number;
}

export interface PublishMessageOptions {
	/**
	 * Pusher socket id to exclude from the broadcast. Set to the sender's own
	 * connection so the browser that originated a message does not receive its own
	 * echo and duplicate the optimistic bubble it already rendered.
	 */
	excludeSocketId?: string | null;
}

export interface RealtimePublisher {
	publishMessageCreated(
		orderId: string,
		conversationId: string,
		message: ConversationMessageDto,
		options?: PublishMessageOptions,
	): Promise<void>;
	publishConversationUpdated(
		orderId: string,
		conversationId: string,
		conversation: ConversationSummary,
	): Promise<void>;
}

export const noopRealtimePublisher: RealtimePublisher = {
	async publishConversationUpdated() {},
	async publishMessageCreated() {},
};

const MAX_PREVIEW_LENGTH = 160;
const CONVERSATION_CHANNEL_PREFIX = "private-order.";
const CONVERSATION_CHANNEL_SEPARATOR = ".conv.";
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function trimMessageBody(body: string): string {
	return body.trim().replace(/\s+/g, " ");
}

export function normalizeConversationPreview(body: string): string {
	const trimmed = trimMessageBody(body);
	if (trimmed.length <= MAX_PREVIEW_LENGTH) {
		return trimmed;
	}
	return `${trimmed.slice(0, MAX_PREVIEW_LENGTH - 3)}...`;
}

export function conversationChannelName(
	orderId: string,
	conversationId: string,
): string {
	if (orderId.length === 0 || conversationId.length === 0) {
		throw new Error("Conversation channel ids must be non-empty.");
	}
	return `${CONVERSATION_CHANNEL_PREFIX}${encodeChannelPart(orderId)}${CONVERSATION_CHANNEL_SEPARATOR}${encodeChannelPart(conversationId)}`;
}

export interface ParsedConversationChannelName {
	conversationId: string;
	orderId: string;
}

export function parseConversationChannelName(
	channelName: string,
): ParsedConversationChannelName | null {
	if (!channelName.startsWith(CONVERSATION_CHANNEL_PREFIX)) {
		return null;
	}
	const body = channelName.slice(CONVERSATION_CHANNEL_PREFIX.length);
	const parts = body.split(CONVERSATION_CHANNEL_SEPARATOR);
	if (parts.length !== 2) {
		return null;
	}
	const [encodedOrderId, encodedConversationId] = parts;
	if (!encodedOrderId || !encodedConversationId) {
		return null;
	}
	const orderId = decodeChannelPart(encodedOrderId);
	const conversationId = decodeChannelPart(encodedConversationId);
	if (!orderId || !conversationId) {
		return null;
	}
	return { conversationId, orderId };
}

function encodeChannelPart(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function decodeChannelPart(value: string): string | null {
	if (!BASE64URL_PATTERN.test(value)) {
		return null;
	}
	const decoded = Buffer.from(value, "base64url").toString("utf8");
	return encodeChannelPart(decoded) === value ? decoded : null;
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? ({ ...(value as Record<string, unknown>) } as Record<string, unknown>)
		: {};
}

function idToString(id: HostifyId | null | undefined): string | null {
	return id === null || id === undefined ? null : String(id);
}

// Hostify serializes `created` as a UTC time with no timezone designator (e.g.
// "2026-06-30 05:21:00"). `new Date()` would read a designator-less string in
// the running process's local zone, shifting every imported message by the
// server's offset (and, via the re-import upsert, our own messages too). Treat a
// designator-less value as UTC; honour an explicit `Z`/offset when present.
function parseDate(value: string | null | undefined): Date | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const hasTimezone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed);
	const normalized = hasTimezone ? trimmed : `${trimmed.replace(" ", "T")}Z`;
	const parsed = new Date(normalized);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function statusFromThread(thread: HostifyThread): ConversationStatus {
	return thread.is_archived === 1 ? "archived" : "active";
}

function previewFromThread(thread: HostifyThread): string | null {
	const preview = thread.preview ?? thread.last_message ?? null;
	return typeof preview === "string" && preview.trim().length > 0
		? normalizeConversationPreview(preview)
		: null;
}

function unreadCountFromThread(thread: HostifyThread): number {
	const unreadCount = thread.channel_unread;
	return typeof unreadCount === "number" &&
		Number.isInteger(unreadCount) &&
		unreadCount > 0
		? unreadCount
		: 0;
}

function mapThread(thread: HostifyThread): ProviderConversationThread | null {
	const externalThreadId = idToString(thread.id);
	if (!externalThreadId) {
		return null;
	}
	return {
		externalThreadId,
		lastMessagePreview: previewFromThread(thread),
		raw: toRecord(thread),
		status: statusFromThread(thread),
		unreadCount: unreadCountFromThread(thread),
	};
}

function mapMessage(
	message: HostifyMessage,
	threadGuestId: string | null,
): ProviderConversationMessage | null {
	const externalMessageId = idToString(message.id);
	const body = trimMessageBody(message.message ?? message.notes ?? "");
	const sentAt = parseDate(message.created);
	if (!externalMessageId || body.length === 0 || !sentAt) {
		return null;
	}

	// Every message in a Hostify thread carries the thread's `guest_id`, so its
	// mere presence says nothing about direction. A message is from the guest only
	// when its `guest_id` matches the thread's guest; host replies and automated
	// messages carry a different (host) id. With no thread guest to compare
	// against, default to host so an imported message never masquerades as the
	// guest.
	const messageGuestId = idToString(message.guest_id);
	const senderType: ConversationMessageSenderType =
		threadGuestId !== null && messageGuestId === threadGuestId
			? "guest"
			: "host";

	return {
		body,
		externalMessageId,
		isAutomatic: message.is_automatic === 1,
		raw: toRecord(message),
		senderType,
		sentAt,
	};
}

export interface HostifyConversationGatewayOptions {
	client: HostifyClient;
	context?: HostifyRequestContext;
}

export class HostifyConversationGateway implements ProviderConversationGateway {
	readonly #client: HostifyClient;
	readonly #context?: HostifyRequestContext;

	constructor(options: HostifyConversationGatewayOptions) {
		this.#client = options.client;
		this.#context = options.context;
	}

	async findThreadForReservation(
		reservationId: string,
	): Promise<ProviderConversationThread | null> {
		const response = await this.#client.inbox.list(
			{
				filters: [
					{ field: "reservation_id", operator: "=", value: reservationId },
				],
				include_related_objects: 1,
				per_page: 5,
			},
			this.#context,
		);
		const match = response.threads.find(
			(thread) => idToString(thread.reservation_id) === reservationId,
		);
		return match ? mapThread(match) : null;
	}

	async getThread(threadId: string): Promise<ProviderConversationSnapshot> {
		const response = await this.#client.inbox.get(threadId, this.#context);
		const thread = mapThread(response.thread);
		if (!thread) {
			throw new Error("Hostify inbox thread response did not include an id.");
		}
		const threadGuestId = idToString(response.thread.guest_id);
		return {
			messages: (response.messages ?? [])
				.map((message) => mapMessage(message, threadGuestId))
				.filter((message): message is ProviderConversationMessage =>
					Boolean(message),
				),
			thread,
		};
	}

	async sendMessage(
		threadId: string,
		body: string,
		channelMessageId: string,
	): Promise<string | null> {
		const response = await this.#client.inbox.receiveReply(
			{
				channel_message_id: channelMessageId,
				message: body,
				sent_by: "guest",
				thread_id: threadId,
			},
			this.#context,
		);
		return idToString(response.id);
	}

	async sendHostReply(threadId: string, body: string): Promise<string | null> {
		const response = await this.#client.inbox.reply(
			{
				message: body,
				thread_id: threadId,
			},
			this.#context,
		);
		return idToString(response.id);
	}
}
