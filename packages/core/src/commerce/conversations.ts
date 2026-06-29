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
	sendMessage(threadId: string, body: string): Promise<string | null>;
}

export interface ConversationSummary {
	externalThreadId: string | null;
	id: string;
	lastMessageAt: string | null;
	lastMessagePreview: string | null;
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

export interface RealtimePublisher {
	publishMessageCreated(
		orderId: string,
		conversationId: string,
		message: ConversationMessageDto,
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
	return `private-order-${orderId}-conv-${conversationId}`;
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? ({ ...(value as Record<string, unknown>) } as Record<string, unknown>)
		: {};
}

function idToString(id: HostifyId | null | undefined): string | null {
	return id === null || id === undefined ? null : String(id);
}

function parseDate(value: string | null | undefined, fallback: Date): Date {
	if (!value) {
		return fallback;
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? fallback : parsed;
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
	fallbackSentAt: Date,
): ProviderConversationMessage | null {
	const externalMessageId = idToString(message.id);
	const body = trimMessageBody(message.message ?? message.notes ?? "");
	if (!externalMessageId || body.length === 0) {
		return null;
	}

	return {
		body,
		externalMessageId,
		isAutomatic: message.is_automatic === 1,
		raw: toRecord(message),
		senderType: message.guest_id ? "guest" : "host",
		sentAt: parseDate(message.created, fallbackSentAt),
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
		const match =
			response.threads.find(
				(thread) => idToString(thread.reservation_id) === reservationId,
			) ?? response.threads[0];
		return match ? mapThread(match) : null;
	}

	async getThread(threadId: string): Promise<ProviderConversationSnapshot> {
		const response = await this.#client.inbox.get(threadId, this.#context);
		const thread = mapThread(response.thread);
		if (!thread) {
			throw new Error("Hostify inbox thread response did not include an id.");
		}
		const fallbackSentAt = new Date();
		return {
			messages: (response.messages ?? [])
				.map((message) => mapMessage(message, fallbackSentAt))
				.filter((message): message is ProviderConversationMessage =>
					Boolean(message),
				),
			thread,
		};
	}

	async sendMessage(threadId: string, body: string): Promise<string | null> {
		const response = await this.#client.inbox.reply(
			{ message: body, send_by: "channel", thread_id: threadId },
			this.#context,
		);
		return idToString(response.id);
	}
}
