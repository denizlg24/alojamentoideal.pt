import { createApp } from "./app.js";
import { getApiConfig } from "./config.js";

const config = getApiConfig();
const app = createApp().listen(config.port);

console.log(`API listening on http://localhost:${config.port}`);

export default app;
