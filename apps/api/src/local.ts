import app from "./index.js";

app.listen(3000);

console.log(`API listening on http://localhost:${app.server?.port ?? 3000}`);
