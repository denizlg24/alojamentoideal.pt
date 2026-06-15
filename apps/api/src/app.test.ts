import { describe, expect, it } from "bun:test";
import { createApp } from "./app.js";

describe("API app", () => {
	it.each(["/health", "/ready"])("serves %s", async (path) => {
		const response = await createApp().handle(
			new Request(`http://localhost${path}`),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			service: "api",
			status: "ok",
		});
	});
});
