import { defineConfig } from "@maizzle/framework";

export default defineConfig({
	plaintext: true,
	content: ["emails/**/*.vue"],
	output: {
		path: "dist",
		extension: "html",
	},
});
