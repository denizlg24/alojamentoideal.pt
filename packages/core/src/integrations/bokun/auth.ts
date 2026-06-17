import { createHmac } from "node:crypto";

export interface BokunSignatureInput {
	accessKey: string;
	date: Date;
	method: string;
	path: string;
	secretKey: string;
}

export interface BokunSignedHeaders {
	"X-Bokun-AccessKey": string;
	"X-Bokun-Date": string;
	"X-Bokun-Signature": string;
}

/**
 * Bokun signs every request with HMAC-SHA1 over the concatenation of the
 * UTC date, access key, HTTP method, and the path (including query string).
 * The signature is Base64 encoded. The secret key is never transmitted.
 */
export function signBokunRequest({
	accessKey,
	date,
	method,
	path,
	secretKey,
}: BokunSignatureInput): BokunSignedHeaders {
	const formattedDate = formatBokunDate(date);
	const message = `${formattedDate}${accessKey}${method.toUpperCase()}${path}`;
	const signature = createHmac("sha1", secretKey)
		.update(message, "utf8")
		.digest("base64");

	return {
		"X-Bokun-AccessKey": accessKey,
		"X-Bokun-Date": formattedDate,
		"X-Bokun-Signature": signature,
	};
}

/** Formats a date as `yyyy-MM-dd HH:mm:ss` in UTC, as Bokun expects. */
export function formatBokunDate(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");

	const year = date.getUTCFullYear();
	const month = pad(date.getUTCMonth() + 1);
	const day = pad(date.getUTCDate());
	const hours = pad(date.getUTCHours());
	const minutes = pad(date.getUTCMinutes());
	const seconds = pad(date.getUTCSeconds());

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
