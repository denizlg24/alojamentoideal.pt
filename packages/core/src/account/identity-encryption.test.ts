import { describe, expect, test } from "bun:test";
import {
	AccountIdentityDecryptionError,
	AccountIdentityEncryptionConfigurationError,
	decryptIdentityField,
	encryptIdentityField,
	getAccountIdentityEncryptionKey,
} from "./identity-encryption";

const KEY = Buffer.from("0".repeat(64), "hex");
const OTHER_KEY = Buffer.from("1".repeat(64), "hex");

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
		expect(ciphertext?.toString("utf8")).not.toContain("P1234567");
		expect(decryptIdentityField(ciphertext, KEY)).toBe("P1234567");
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
