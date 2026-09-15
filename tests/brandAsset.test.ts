import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const EXPECTED_SHA256 = "5dc516ad62eec0f6f99f1b72f90cc058e590a72da84e62de78d8d4aaae2272a4";
const DATA_URL_PREFIX = "data:image/webp;base64,";

describe("Azu Creator brand asset", () => {
  it("keeps the approved Azu avatar bytes and bundled data URL contract intact", async () => {
    const bytes = await readFile(new URL("../src/client/assets/azu-creator-icon.webp", import.meta.url));
    const source = await readFile(new URL("../src/client/assets/azuIcon.ts", import.meta.url), "utf8");
    const dataUrl = `${DATA_URL_PREFIX}${bytes.toString("base64")}`;

    expect(bytes.length).toBe(24406);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(EXPECTED_SHA256);
    expect(dataUrl.startsWith(DATA_URL_PREFIX)).toBe(true);
    expect(Buffer.from(dataUrl.slice(DATA_URL_PREFIX.length), "base64")).toEqual(bytes);
    expect(source).toContain("azu-creator-icon.webp");
    expect(source).toContain("AZU_ICON_SRC");
  });
});
