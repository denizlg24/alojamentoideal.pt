/**
 * httpOnly cookie carrying the secret anonymous cart token. Shared between the
 * web commerce layer (read/write) and the auth session hook (reads it to merge
 * an anonymous cart into the account on login), which is why it lives here in
 * the single package both already depend on.
 */
export const CART_COOKIE_NAME = "ai_cart";
