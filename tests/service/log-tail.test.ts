import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLogTail } from "../../src/service/log-tail.ts";

describe("readLogTail", () => {
  it("returns last lines from service log", () => {
    const dir = mkdtempSync(join(tmpdir(), "eport-log-"));
    const path = join(dir, "service.log");
    writeFileSync(path, "line1\nline2\nline3\n", "utf8");
    const tail = readLogTail(path, 2);
    expect(tail.exists).toBe(true);
    expect(tail.lines).toEqual(["line2", "line3"]);
    rmSync(dir, { recursive: true, force: true });
  });
});
