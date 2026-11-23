import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../services/enta/server/src/app.js";

const INTERNAL_PATH_PARAMETER = "__api_path";
const INTERNAL_FUNCTION_PATH = "/api/index";

function isSafeApiPath(path: string): boolean {
  if (!path.startsWith("/api/") || path === INTERNAL_FUNCTION_PATH) return false;
  const apiPath = path.slice("/api/".length);
  const segments = apiPath.split("/");
  return segments.every((segment) =>
    !!segment && segment !== "." && segment !== ".." && /^[A-Za-z0-9._~-]+$/.test(segment),
  );
}

/** Restore the request URL if Vercel supplies either the original path or its rewrite destination. */
export function restoreOriginalApiUrl(requestUrl: string | undefined): string | undefined {
  if (!requestUrl || requestUrl.includes("#")) return undefined;
  const question = requestUrl.indexOf("?");
  const rawPath = question < 0 ? requestUrl : requestUrl.slice(0, question);
  const rawQuery = question < 0 ? "" : requestUrl.slice(question + 1);

  // Some Vercel runtimes preserve the public pathname across same-app rewrites.
  // Validate the raw path before URL parsing so dot-segment normalization cannot hide traversal.
  if (rawPath !== INTERNAL_FUNCTION_PATH && isSafeApiPath(rawPath)) {
    return requestUrl;
  }

  let rewritten: URL;
  try {
    rewritten = new URL(requestUrl, "http://vercel.invalid");
  } catch {
    return undefined;
  }
  if (rewritten.pathname !== INTERNAL_FUNCTION_PATH || rawPath !== INTERNAL_FUNCTION_PATH) return undefined;

  const pathValues = rewritten.searchParams.getAll(INTERNAL_PATH_PARAMETER);
  if (pathValues.length !== 1) return undefined;

  const rawPathValues = rawQuery.split("&").flatMap((pair) => {
    const equals = pair.indexOf("=");
    const rawKey = equals < 0 ? pair : pair.slice(0, equals);
    let key: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    } catch {
      return [];
    }
    return key === INTERNAL_PATH_PARAMETER ? [equals < 0 ? "" : pair.slice(equals + 1)] : [];
  });
  if (rawPathValues.length !== 1 || !rawPathValues[0]) return undefined;
  // Vercel may percent-encode captured separators. Permit encoded forward
  // slashes only; reject encoded backslash, dot, or percent (double encoding).
  if (/%(?:5c|2e|25)/i.test(rawPathValues[0])) return undefined;

  let capturedPath: string;
  try {
    capturedPath = decodeURIComponent(rawPathValues[0].replace(/\+/g, " "));
  } catch {
    return undefined;
  }
  if (!capturedPath || capturedPath.startsWith("/") || capturedPath.includes("\\") ||
    !isSafeApiPath(`/api/${capturedPath}`)) return undefined;

  // Vercel adds __api_path for the rewrite destination. The unnamed regex
  // capture avoids an implicit `path` query parameter, so remove only this
  // routing parameter and keep caller-supplied query parameters and duplicates.
  const originalQuery = new URLSearchParams(rewritten.searchParams);
  originalQuery.delete(INTERNAL_PATH_PARAMETER);
  const query = originalQuery.toString();
  return `/api/${capturedPath}${query ? `?${query}` : ""}`;
}

type VercelRequest = IncomingMessage & { url?: string };
let apiApp: ReturnType<typeof createApp> | undefined;

export default function handler(request: VercelRequest, response: ServerResponse): void {
  const originalUrl = restoreOriginalApiUrl(request.url);
  if (!originalUrl) {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.end(JSON.stringify({ error: "NOT_FOUND" }));
    return;
  }

  request.url = originalUrl;
  apiApp ??= createApp();
  apiApp(request, response);
}
