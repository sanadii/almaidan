import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../src/app';

// Vercel's Node.js runtime accepts any (req, res) handler, and an Express
// app is exactly that. The app is composed lazily on the first request, the
// same way the root api/index.ts adapter does, so importing this module never
// reads runtime configuration by itself.
let app: ReturnType<typeof createApp> | undefined;
export default function handler(req: IncomingMessage, res: ServerResponse): void {
  app ??= createApp();
  app(req, res);
}
