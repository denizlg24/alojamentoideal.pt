import { getApiConfig } from "./config.js";
import app from "./index.js";

const config = getApiConfig();

app.listen(config.port);

console.log(`API listening on http://localhost:${config.port}`);
