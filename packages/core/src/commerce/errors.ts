export type CommerceErrorCode =
	| "activity_details_invalid"
	| "booking_guest_not_found"
	| "cart_changed"
	| "cart_converted"
	| "cart_expired"
	| "cart_item_overlap"
	| "cart_not_found"
	| "cart_not_mutable"
	| "conversation_message_not_found"
	| "conversation_not_found"
	| "conversation_unavailable"
	| "activity_booking_unavailable"
	| "activity_unavailable"
	| "dates_unavailable"
	| "discount_invalid"
	| "discount_unavailable"
	| "empty_cart"
	| "idempotency_in_progress"
	| "idempotency_key_reused"
	| "invalid_request"
	| "item_not_editable"
	| "item_not_found"
	| "order_access_denied"
	| "order_expired"
	| "order_full"
	| "order_member_exists"
	| "order_member_immutable"
	| "order_member_not_found"
	| "order_not_charged"
	| "order_not_found"
	| "order_not_payable"
	| "order_reference_unavailable"
	| "payment_unavailable"
	| "pricing_unavailable"
	| "quote_expired"
	| "quote_revalidation_failed"
	| "quote_snapshot_invalid"
	| "refund_amount_exceeds_refundable"
	| "refund_amount_invalid"
	| "refund_failed"
	| "refund_precondition_failed"
	| "refund_unavailable"
	| "reservation_cancel_failed"
	| "reservation_gateway_unavailable"
	| "reservation_unavailable"
	| "too_many_guests";

export interface CommerceIssue {
	message: string;
	path: string;
}

export class CommerceError extends Error {
	readonly code: CommerceErrorCode;
	readonly issues: CommerceIssue[];
	readonly status: number;

	constructor(
		code: CommerceErrorCode,
		message: string,
		status: number,
		options: { issues?: CommerceIssue[] } = {},
	) {
		super(message);
		this.name = "CommerceError";
		this.code = code;
		this.status = status;
		this.issues = options.issues ?? [];
	}
}

export function invalidRequest(message: string, issues: CommerceIssue[] = []) {
	return new CommerceError("invalid_request", message, 400, { issues });
}
