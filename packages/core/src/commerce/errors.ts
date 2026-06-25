export type CommerceErrorCode =
	| "cart_changed"
	| "cart_converted"
	| "cart_expired"
	| "cart_not_found"
	| "cart_not_mutable"
	| "dates_unavailable"
	| "discount_invalid"
	| "discount_unavailable"
	| "empty_cart"
	| "idempotency_in_progress"
	| "idempotency_key_reused"
	| "invalid_request"
	| "item_not_found"
	| "order_expired"
	| "order_not_found"
	| "order_not_payable"
	| "order_reference_unavailable"
	| "payment_unavailable"
	| "pricing_unavailable"
	| "quote_expired"
	| "quote_revalidation_failed"
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
