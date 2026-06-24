import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { optionalString } from "../internal/env";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const KEY_ID_BYTES = 4;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const LEGACY_FORMAT_VERSION = 1;
const FORMAT_VERSION = 2;
const LEGACY_HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const HEADER_BYTES = 1 + KEY_ID_BYTES + NONCE_BYTES + TAG_BYTES;
const ACCOUNT_IDENTITY_AAD = Buffer.from(
	"alojamentoideal.account-identity.v1",
	"utf8",
);

interface IdentityEncryptionEnvironment {
	ACCOUNT_IDENTITY_ENCRYPTION_KEY?: string;
	ACCOUNT_IDENTITY_ENCRYPTION_KEY_RING?: string;
}

export class AccountIdentityEncryptionConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AccountIdentityEncryptionConfigurationError";
	}
}

export class AccountIdentityDecryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AccountIdentityDecryptionError";
	}
}

function decodeConfiguredKey(value: string): Buffer {
	if (/^[a-f0-9]{64}$/i.test(value)) {
		return Buffer.from(value, "hex");
	}

	return Buffer.from(value, "base64");
}

function assertKeySize(key: Buffer): void {
	if (key.byteLength !== KEY_BYTES) {
		throw new AccountIdentityEncryptionConfigurationError(
			"identity encryption key must be 32 bytes",
		);
	}
}

function keyIdentifier(key: Buffer): Buffer {
	return createHash("sha256").update(key).digest().subarray(0, KEY_ID_BYTES);
}

function sameKeyIdentifier(left: Buffer, right: Buffer): boolean {
	return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function normalizeKeyRing(keyOrKeys: Buffer | readonly Buffer[]): Buffer[] {
	const keys = Array.isArray(keyOrKeys) ? [...keyOrKeys] : [keyOrKeys];
	if (keys.length === 0) {
		throw new AccountIdentityEncryptionConfigurationError(
			"at least one identity encryption key is required",
		);
	}
	for (const key of keys) {
		assertKeySize(key);
	}
	return keys;
}

function parseKeyRing(value: string | undefined): Buffer[] {
	const configured = optionalString(value);
	if (!configured) {
		return [];
	}
	return configured
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map(decodeConfiguredKey);
}

export function getAccountIdentityEncryptionKey(
	environment: IdentityEncryptionEnvironment = {
		ACCOUNT_IDENTITY_ENCRYPTION_KEY:
			process.env.ACCOUNT_IDENTITY_ENCRYPTION_KEY,
		ACCOUNT_IDENTITY_ENCRYPTION_KEY_RING:
			process.env.ACCOUNT_IDENTITY_ENCRYPTION_KEY_RING,
	},
): Buffer {
	const [key] = getAccountIdentityEncryptionKeys(environment);
	if (!key) {
		throw new AccountIdentityEncryptionConfigurationError(
			"ACCOUNT_IDENTITY_ENCRYPTION_KEY is required",
		);
	}
	return key;
}

export function getAccountIdentityEncryptionKeys(
	environment: IdentityEncryptionEnvironment = {
		ACCOUNT_IDENTITY_ENCRYPTION_KEY:
			process.env.ACCOUNT_IDENTITY_ENCRYPTION_KEY,
		ACCOUNT_IDENTITY_ENCRYPTION_KEY_RING:
			process.env.ACCOUNT_IDENTITY_ENCRYPTION_KEY_RING,
	},
): Buffer[] {
	const configured = optionalString(
		environment.ACCOUNT_IDENTITY_ENCRYPTION_KEY,
	);
	if (!configured) {
		throw new AccountIdentityEncryptionConfigurationError(
			"ACCOUNT_IDENTITY_ENCRYPTION_KEY is required",
		);
	}

	const keys = [
		decodeConfiguredKey(configured),
		...parseKeyRing(environment.ACCOUNT_IDENTITY_ENCRYPTION_KEY_RING),
	];
	for (const key of keys) {
		if (key.byteLength !== KEY_BYTES) {
			throw new AccountIdentityEncryptionConfigurationError(
				"ACCOUNT_IDENTITY_ENCRYPTION_KEY values must decode to 32 bytes",
			);
		}
	}

	const seen = new Set<string>();
	return keys.filter((key) => {
		const id = keyIdentifier(key).toString("hex");
		if (seen.has(id)) {
			return false;
		}
		seen.add(id);
		return true;
	});
}

export function encryptIdentityField(
	value: string | null | undefined,
	keyOrKeys: Buffer | readonly Buffer[] = getAccountIdentityEncryptionKeys(),
): Buffer | null {
	if (value === null || value === undefined) {
		return null;
	}
	const [key] = normalizeKeyRing(keyOrKeys);
	if (!key) {
		throw new AccountIdentityEncryptionConfigurationError(
			"at least one identity encryption key is required",
		);
	}

	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, nonce, {
		authTagLength: TAG_BYTES,
	});
	cipher.setAAD(ACCOUNT_IDENTITY_AAD);
	const ciphertext = Buffer.concat([
		cipher.update(value, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();

	return Buffer.concat([
		Buffer.from([FORMAT_VERSION]),
		keyIdentifier(key),
		nonce,
		tag,
		ciphertext,
	]);
}

function decryptWithKey({
	ciphertext,
	key,
	nonce,
	tag,
}: {
	ciphertext: Buffer;
	key: Buffer;
	nonce: Buffer;
	tag: Buffer;
}): string {
	try {
		const decipher = createDecipheriv(ALGORITHM, key, nonce, {
			authTagLength: TAG_BYTES,
		});
		decipher.setAAD(ACCOUNT_IDENTITY_AAD);
		decipher.setAuthTag(tag);
		return Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]).toString("utf8");
	} catch (error) {
		throw new AccountIdentityDecryptionError(
			error instanceof Error
				? `identity ciphertext authentication failed: ${error.message}`
				: "identity ciphertext authentication failed",
		);
	}
}

function tryDecryptWithKeys({
	ciphertext,
	keys,
	nonce,
	tag,
}: {
	ciphertext: Buffer;
	keys: Buffer[];
	nonce: Buffer;
	tag: Buffer;
}): string {
	let lastError: AccountIdentityDecryptionError | null = null;
	for (const key of keys) {
		try {
			return decryptWithKey({ ciphertext, key, nonce, tag });
		} catch (error) {
			if (error instanceof AccountIdentityDecryptionError) {
				lastError = error;
				continue;
			}
			throw error;
		}
	}
	throw (
		lastError ??
		new AccountIdentityDecryptionError(
			"identity ciphertext authentication failed",
		)
	);
}

export function decryptIdentityField(
	value: Buffer | Uint8Array | null | undefined,
	keyOrKeys: Buffer | readonly Buffer[] = getAccountIdentityEncryptionKeys(),
): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	const keys = normalizeKeyRing(keyOrKeys);

	const stored = Buffer.from(value);
	if (stored[0] === LEGACY_FORMAT_VERSION) {
		if (stored.byteLength < LEGACY_HEADER_BYTES) {
			throw new AccountIdentityDecryptionError(
				"identity ciphertext is not a supported format",
			);
		}
		const nonce = stored.subarray(1, 1 + NONCE_BYTES);
		const tag = stored.subarray(1 + NONCE_BYTES, LEGACY_HEADER_BYTES);
		const ciphertext = stored.subarray(LEGACY_HEADER_BYTES);
		return tryDecryptWithKeys({ ciphertext, keys, nonce, tag });
	}

	if (stored.byteLength < HEADER_BYTES || stored[0] !== FORMAT_VERSION) {
		throw new AccountIdentityDecryptionError(
			"identity ciphertext is not a supported format",
		);
	}

	const storedKeyId = stored.subarray(1, 1 + KEY_ID_BYTES);
	const nonceStart = 1 + KEY_ID_BYTES;
	const nonce = stored.subarray(nonceStart, nonceStart + NONCE_BYTES);
	const tag = stored.subarray(nonceStart + NONCE_BYTES, HEADER_BYTES);
	const ciphertext = stored.subarray(HEADER_BYTES);
	const matchingKey = keys.find((key) =>
		sameKeyIdentifier(keyIdentifier(key), storedKeyId),
	);
	const orderedKeys = matchingKey
		? [matchingKey, ...keys.filter((key) => !key.equals(matchingKey))]
		: keys;

	return tryDecryptWithKeys({ ciphertext, keys: orderedKeys, nonce, tag });
}
