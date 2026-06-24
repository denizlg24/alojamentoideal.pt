import { describe, expect, test } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import {
	AccountIdentityDecryptionError,
	AccountIdentityEncryptionConfigurationError,
	decryptIdentityField,
	encryptIdentityField,
	getAccountIdentityEncryptionKey,
	getAccountIdentityEncryptionKeys,
} from "./identity-encryption";

const KEY = Buffer.from("0".repeat(64), "hex");
const OTHER_KEY = Buffer.from("1".repeat(64), "hex");
const AAD = Buffer.from("alojamentoideal.account-identity.v1", "utf8");

function legacyEncrypt(value: string, key: Buffer): Buffer {
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, nonce, {
		authTagLength: 16,
	});
	cipher.setAAD(AAD);
	const ciphertext = Buffer.concat([
		cipher.update(value, "utf8"),
		cipher.final(),
	]);

	return Buffer.concat([
		Buffer.from([1]),
		nonce,
		cipher.getAuthTag(),
		ciphertext,
	]);
}

describe("account identity encryption", () => {
	test("loads a configured base64 key", () => {
		const key = getAccountIdentityEncryptionKey({
			ACCOUNT_IDENTITY_ENCRYPTION_KEY: KEY.toString("base64"),
		});

		expect(key.equals(KEY)).toBe(true);
	});

	test("loads a configured hex key", () => {
		const key = getAccountIdentityEncryptionKey({
			ACCOUNT_IDENTITY_ENCRYPTION_KEY: KEY.toString("hex"),
		});

		expect(key.equals(KEY)).toBe(true);
	});

	test("loads a configured key ring", () => {
		const keys = getAccountIdentityEncryptionKeys({
			ACCOUNT_IDENTITY_ENCRYPTION_KEY: KEY.toString("hex"),
			ACCOUNT_IDENTITY_ENCRYPTION_KEY_RING: OTHER_KEY.toString("hex"),
		});

		expect(keys).toHaveLength(2);
		expect(keys[0]?.equals(KEY)).toBe(true);
		expect(keys[1]?.equals(OTHER_KEY)).toBe(true);
	});

	test("fails closed when the key is missing", () => {
		expect(() => getAccountIdentityEncryptionKey({})).toThrow(
			AccountIdentityEncryptionConfigurationError,
		);
	});

	test("fails closed when the key has the wrong size", () => {
		expect(() =>
			getAccountIdentityEncryptionKey({
				ACCOUNT_IDENTITY_ENCRYPTION_KEY:
					Buffer.from("short").toString("base64"),
			}),
		).toThrow(AccountIdentityEncryptionConfigurationError);
	});

	test("round trips an identity field", () => {
		const ciphertext = encryptIdentityField("P1234567", KEY);

		expect(ciphertext).toBeInstanceOf(Buffer);
		expect(ciphertext?.[0]).toBe(2);
		expect(ciphertext?.toString("utf8")).not.toContain("P1234567");
		expect(decryptIdentityField(ciphertext, KEY)).toBe("P1234567");
	});

	test("decrypts key-identified ciphertext with the matching ring key", () => {
		const ciphertext = encryptIdentityField("P1234567", OTHER_KEY);

		expect(decryptIdentityField(ciphertext, [KEY, OTHER_KEY])).toBe("P1234567");
	});

	test("decrypts legacy ciphertext by trying the configured ring", () => {
		const ciphertext = legacyEncrypt("P1234567", OTHER_KEY);

		expect(decryptIdentityField(ciphertext, [KEY, OTHER_KEY])).toBe("P1234567");
	});

	test("returns null for nullish values", () => {
		expect(encryptIdentityField(null, KEY)).toBeNull();
		expect(encryptIdentityField(undefined, KEY)).toBeNull();
		expect(decryptIdentityField(null, KEY)).toBeNull();
		expect(decryptIdentityField(undefined, KEY)).toBeNull();
	});

	test("uses a fresh nonce for each encryption", () => {
		const first = encryptIdentityField("P1234567", KEY);
		const second = encryptIdentityField("P1234567", KEY);

		expect(first?.equals(second as Buffer)).toBe(false);
		expect(decryptIdentityField(first, KEY)).toBe("P1234567");
		expect(decryptIdentityField(second, KEY)).toBe("P1234567");
	});

	test("rejects ciphertext with the wrong key", () => {
		const ciphertext = encryptIdentityField("P1234567", KEY);

		expect(() => decryptIdentityField(ciphertext, OTHER_KEY)).toThrow(
			AccountIdentityDecryptionError,
		);
	});

	test("rejects malformed ciphertext", () => {
		expect(() => decryptIdentityField(Buffer.from("bad"), KEY)).toThrow(
			AccountIdentityDecryptionError,
		);
	});
});
