import { describe, expect, it } from "bun:test";
import app from "./index.js";

describe("API app", () => {
	it("exports an unstarted Elysia app for Vercel", () => {
		expect(typeof app.fetch).toBe("function");
		expect(app.server).toBeNull();
	});

	it.each(["/health", "/ready"])("serves %s", async (path) => {
		const response = await app.handle(new Request(`http://localhost${path}`));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			service: "api",
			status: "ok",
		});
	});
});
