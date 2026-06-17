import { existsSync, readFileSync } from "node:fs";

export function readLogTail(path: string, maxLines = 40): { exists: boolean; lines: string[] } {
  if (!existsSync(path)) {
    return { exists: false, lines: [] };
  }

  const content = readFileSync(path, "utf8");
  const lines = content.split(/\r?\n/).filter((line, index, all) => {
    return line.length > 0 || index < all.length - 1;
  });
  return { exists: true, lines: lines.slice(-maxLines) };
}
