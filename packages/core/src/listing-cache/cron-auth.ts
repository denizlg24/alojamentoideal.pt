import { timingSafeEqual } from "node:crypto";

/**
 * Validates a cron request against the expected secret, accepting either an
 * `Authorization: Bearer <secret>` header or an `x-cron-secret` header.
 */
export function isAuthorizedCronRequest(
	request: Request,
	expectedSecret: string,
): boolean {
	const authorization = request.headers.get("authorization");
	const bearerSecret = authorization?.startsWith("Bearer ")
		? authorization.slice("Bearer ".length)
		: undefined;
	const providedSecret = bearerSecret ?? request.headers.get("x-cron-secret");

	if (!providedSecret) {
		return false;
	}

	return safeEqual(providedSecret, expectedSecret);
}

function safeEqual(value: string, expected: string): boolean {
	const valueBuffer = Buffer.from(value);
	const expectedBuffer = Buffer.from(expected);

	return (
		valueBuffer.length === expectedBuffer.length &&
		timingSafeEqual(valueBuffer, expectedBuffer)
	);
}
