import { stat } from "node:fs/promises";

async function fileVersion(path: string) {
  try {
    const info = await stat(path, { bigint: true });
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

/** Overlay publication replaces the snapshot file atomically. */
export function cacheLocalQuestionSource<T>(paths: readonly string[], load: () => Promise<T>) {
  let cached: { version: string; source: T } | undefined;
  let pending: Promise<T> | undefined;

  return () => {
    pending ??= (async () => {
      const version = (await Promise.all(paths.map(fileVersion))).join("/");
      if (cached?.version === version) return cached.source;

      const source = await load();
      cached = { version, source };
      return source;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
