import type {
	BookingGuestList,
	BookingGuestUpdateInput,
	ConversationMessageDto,
	ConversationSummary,
	OrderDetail,
} from "@workspace/core/commerce";
import type { OrderMemberRole, OrderMemberStatus } from "@workspace/db";
import { readCheckoutError, toCheckoutError } from "@/lib/checkout/errors";

/**
 * Typed client over the `/api/orders/[reference]` route handlers, used by the
 * order-hub client components. Same-origin cookies (the order-scoped member
 * cookie, cart cookie, session) ride along automatically. Every non-2xx is
 * normalized into a `CheckoutError`, reusing the checkout error vocabulary so
 * the hub UI handles a single error type.
 */
async function request<T>(input: string, init?: RequestInit): Promise<T> {
	let response: Response;
	try {
		response = await fetch(input, {
			...init,
			headers: { "content-type": "application/json", ...init?.headers },
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			throw error;
		}
		throw toCheckoutError(error);
	}

	if (!response.ok) {
		throw await readCheckoutError(response);
	}
	if (response.status === 204) {
		return undefined as T;
	}
	return (await response.json()) as T;
}

function jsonBody(body: unknown, method = "POST"): RequestInit {
	return { body: JSON.stringify(body), method };
}

const seg = (value: string) => encodeURIComponent(value);
const base = (reference: string) => `/api/orders/${seg(reference)}`;

export function getOrderDetail(reference: string): Promise<OrderDetail> {
	return request<OrderDetail>(base(reference));
}

// --- Conversations (F2) ---

export function getConversationMessages(
	reference: string,
	conversationId: string,
	limit?: number,
): Promise<{ messages: ConversationMessageDto[] }> {
	const query = limit ? `?limit=${limit}` : "";
	return request<{ messages: ConversationMessageDto[] }>(
		`${base(reference)}/conversations/${seg(conversationId)}/messages${query}`,
	);
}

export function sendConversationMessage(
	reference: string,
	conversationId: string,
	body: string,
	socketId?: string | null,
): Promise<{ message: ConversationMessageDto }> {
	return request<{ message: ConversationMessageDto }>(
		`${base(reference)}/conversations/${seg(conversationId)}/messages`,
		jsonBody({ body, socketId }),
	);
}

export function retryConversationMessage(
	reference: string,
	conversationId: string,
	messageId: string,
	socketId?: string | null,
): Promise<{ message: ConversationMessageDto }> {
	return request<{ message: ConversationMessageDto }>(
		`${base(reference)}/conversations/${seg(conversationId)}/messages/${seg(
			messageId,
		)}/retry`,
		jsonBody({ socketId }),
	);
}

export function listConversations(
	reference: string,
): Promise<{ conversations: ConversationSummary[] }> {
	return request<{ conversations: ConversationSummary[] }>(
		`${base(reference)}/conversations`,
	);
}

// --- Guests (F3) ---

export function getBookingGuests(
	reference: string,
	bookingId: string,
): Promise<BookingGuestList> {
	return request<BookingGuestList>(
		`${base(reference)}/bookings/${seg(bookingId)}/guests`,
	);
}

export function updateBookingGuests(
	reference: string,
	bookingId: string,
	guests: BookingGuestUpdateInput[],
): Promise<BookingGuestList> {
	return request<BookingGuestList>(
		`${base(reference)}/bookings/${seg(bookingId)}/guests`,
		jsonBody({ guests }, "PUT"),
	);
}

export interface GuestIdentitySessionResult {
	clientSecret: string | null;
	status: string;
}

export function createGuestIdentitySession(
	reference: string,
	bookingId: string,
	guestId: string,
): Promise<GuestIdentitySessionResult> {
	return request<GuestIdentitySessionResult>(
		`${base(reference)}/bookings/${seg(bookingId)}/guests/${seg(
			guestId,
		)}/identity-session`,
		jsonBody({}),
	);
}

// --- Members (F4) ---

export interface OrderMemberInvite {
	email: string;
	expiresAt: string | null;
	id: string;
	role: OrderMemberRole;
	status: OrderMemberStatus;
}

export function inviteOrderMember(
	reference: string,
	email: string,
): Promise<{ member: OrderMemberInvite }> {
	return request<{ member: OrderMemberInvite }>(
		`${base(reference)}/members`,
		jsonBody({ email }),
	);
}

export function revokeOrderMember(
	reference: string,
	memberId: string,
): Promise<void> {
	return request<void>(`${base(reference)}/members/${seg(memberId)}`, {
		method: "DELETE",
	});
}

export function resendOrderMemberInvite(
	reference: string,
	memberId: string,
): Promise<{ member: OrderMemberInvite }> {
	return request<{ member: OrderMemberInvite }>(
		`${base(reference)}/members/${seg(memberId)}/resend`,
		jsonBody({}),
	);
}
