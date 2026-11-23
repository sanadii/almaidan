import "dotenv/config";
import { createApp } from "./app";

const app = createApp();
const port = Number(process.env.ENTA_API_PORT ?? 4001);
const host = process.env.ENTA_API_HOST ?? "127.0.0.1";
app.listen(port, host, () => console.log(`Enta API v1 listening on http://${host}:${port}`));
