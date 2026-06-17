import { describe, expect, it } from "bun:test";
import { sanitizeProviderPayload, stableHash } from "./hash";

describe("listing cache hashing", () => {
	it("hashes canonical object content independent of key order", () => {
		const left = stableHash({
			amenities: [{ id: 1, name: "Wifi" }],
			title: "Apartment",
		});
		const right = stableHash({
			title: "Apartment",
			amenities: [{ name: "Wifi", id: 1 }],
		});

		expect(left).toBe(right);
	});

	it("removes secret-like provider fields before storage", () => {
		expect(
			sanitizeProviderPayload({
				access_code: "1234",
				guide: {
					check_in: "Use the main entrance",
					wifi_password: "secret",
				},
			}),
		).toEqual({
			guide: {
				check_in: "Use the main entrance",
			},
		});
	});
});
