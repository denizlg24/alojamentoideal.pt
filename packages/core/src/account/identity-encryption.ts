import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { optionalString } from "../internal/env";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_VERSION = 1;
const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const ACCOUNT_IDENTITY_AAD = Buffer.from(
	"alojamentoideal.account-identity.v1",
	"utf8",
);

interface IdentityEncryptionEnvironment {
	ACCOUNT_IDENTITY_ENCRYPTION_KEY?: string;
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

export function getAccountIdentityEncryptionKey(
	environment: IdentityEncryptionEnvironment = {
		ACCOUNT_IDENTITY_ENCRYPTION_KEY:
			process.env.ACCOUNT_IDENTITY_ENCRYPTION_KEY,
	},
): Buffer {
	const configured = optionalString(
		environment.ACCOUNT_IDENTITY_ENCRYPTION_KEY,
	);
	if (!configured) {
		throw new AccountIdentityEncryptionConfigurationError(
			"ACCOUNT_IDENTITY_ENCRYPTION_KEY is required",
		);
	}

	const key = decodeConfiguredKey(configured);
	if (key.byteLength !== KEY_BYTES) {
		throw new AccountIdentityEncryptionConfigurationError(
			"ACCOUNT_IDENTITY_ENCRYPTION_KEY must decode to 32 bytes",
		);
	}

	return key;
}

export function encryptIdentityField(
	value: string | null | undefined,
	key: Buffer = getAccountIdentityEncryptionKey(),
): Buffer | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (key.byteLength !== KEY_BYTES) {
		throw new AccountIdentityEncryptionConfigurationError(
			"identity encryption key must be 32 bytes",
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

	return Buffer.concat([Buffer.from([FORMAT_VERSION]), nonce, tag, ciphertext]);
}

export function decryptIdentityField(
	value: Buffer | Uint8Array | null | undefined,
	key: Buffer = getAccountIdentityEncryptionKey(),
): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (key.byteLength !== KEY_BYTES) {
		throw new AccountIdentityEncryptionConfigurationError(
			"identity encryption key must be 32 bytes",
		);
	}

	const stored = Buffer.from(value);
	if (stored.byteLength < HEADER_BYTES || stored[0] !== FORMAT_VERSION) {
		throw new AccountIdentityDecryptionError(
			"identity ciphertext is not a supported format",
		);
	}

	const nonce = stored.subarray(1, 1 + NONCE_BYTES);
	const tag = stored.subarray(1 + NONCE_BYTES, HEADER_BYTES);
	const ciphertext = stored.subarray(HEADER_BYTES);

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
