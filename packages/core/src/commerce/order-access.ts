import { createHash, randomBytes } from "node:crypto";
import type { OrderMember, OrderMemberRole } from "@workspace/db";
import type { CartOwner } from "./types";

/**
 * The role a resolved member holds on an order. `owner` is the booker (full
 * access); `member` is an invited guest. Kept distinct from the DB row type so
 * the permission matrix can be reasoned about without a database read.
 */
export type OrderRole = OrderMemberRole;

/**
 * Permissions gate every order-scoped route. Defining them once here (rather
 * than re-deriving `role === "owner"` checks per route) keeps the access model
 * auditable: a single matrix decides who can see prices, invite people, or edit
 * another guest's identity.
 */
export const ORDER_PERMISSION_LIST = [
	"view_booking",
	"view_price",
	"view_contact",
	"chat",
	"invite_members",
	"manage_members",
	"manage_all_guests",
	"manage_own_guest",
] as const;

export type OrderPermission = (typeof ORDER_PERMISSION_LIST)[number];

const ORDER_PERMISSIONS: Record<OrderRole, ReadonlySet<OrderPermission>> = {
	owner: new Set<OrderPermission>(ORDER_PERMISSION_LIST),
	member: new Set<OrderPermission>(["view_booking", "manage_own_guest"]),
};

/** Pure permission decision for a resolved order role. */
export function orderRoleCan(
	role: OrderRole,
	permission: OrderPermission,
): boolean {
	return ORDER_PERMISSIONS[role].has(permission);
}

/**
 * Authorization input for an order-scoped operation. Extends {@link CartOwner}
 * (the original cart-cookie / signed-in-user grant paths that resolve the
 * `owner`) with the optional booking-access token presented by an invited
 * member (from the redeemed `ai_order_member` cookie or a raw `?token=`).
 */
export interface OrderAccessContext extends CartOwner {
	memberToken?: string | null;
}

/** Minimal order identity an access decision needs, resolved by reference. */
export interface ResolvedOrder {
	cartToken: string | null;
	id: string;
	publicReference: string;
	status: string;
	userId: string | null;
}

/**
 * The outcome of {@link CommerceService.resolveOrderAccess}: the order, the
 * caller's role, and the member row backing it when one exists. `member` may be
 * `null` for an owner who is authorized by the cart/user grant before an
 * `order_members` owner row has been provisioned (B1).
 */
export interface ResolvedOrderAccess {
	member: OrderMember | null;
	order: ResolvedOrder;
	role: OrderRole;
}

/** Token byte length. 32 bytes = 256 bits of entropy (the access spine). */
const MEMBER_TOKEN_BYTES = 32;

/** Generates a single-use, URL-safe booking-access token (returned once). */
export function generateMemberToken(): string {
	return randomBytes(MEMBER_TOKEN_BYTES).toString("base64url");
}

/**
 * Hashes a raw booking-access token for at-rest storage and lookup. The raw
 * token never touches the database; the column is a unique sha-256 digest, so a
 * leaked DB row cannot be replayed as a credential.
 */
export function hashMemberToken(rawToken: string): string {
	return createHash("sha256").update(rawToken).digest("hex");
}

/** A member whose access window has lapsed is treated as not found. */
export function isMemberTokenExpired(
	member: Pick<OrderMember, "expiresAt">,
	now: Date,
): boolean {
	return (
		member.expiresAt !== null && member.expiresAt.getTime() <= now.getTime()
	);
}

/**
 * Invite lifetime. An invited member's token is deliberately short-lived: a
 * magic-link forwarded in an email is a bearer credential, so an unaccepted
 * invite lapses in 24 hours and a fresh link must be re-issued (rotate-on-resend).
 * The owner token, by contrast, carries no expiry — the booker needs durable
 * cross-device access to their own order.
 */
export const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** The `expires_at` an invited member token should carry from `now`. */
export function memberInviteExpiresAt(now: Date = new Date()): Date {
	return new Date(now.getTime() + INVITE_TOKEN_TTL_MS);
}

// Order capacity is no longer counted: per-guest invites bind a specific booking
// slot at invite time, so the finite slot count structurally caps how many people
// can be invited or accepted. The old `orderMemberCapacity` / `canAcceptMember`
// helpers were removed with that change.
