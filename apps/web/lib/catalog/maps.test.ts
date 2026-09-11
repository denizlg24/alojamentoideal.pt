import { describe, expect, test } from "bun:test";
import { getCartoTileUrl } from "./maps";

describe("getCartoTileUrl", () => {
	test("adds an encoded CARTO API key", () => {
		expect(getCartoTileUrl(" public/key? ")).toBe(
			"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=public%2Fkey%3F",
		);
	});

	test("keeps the tile URL usable when the key is not configured", () => {
		expect(getCartoTileUrl("  ")).toBe(
			"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
		);
	});
});
