import { describe, expect, it } from "vitest";
// RAMBLA-FORK: fix: 2026-09-30-fix-eradicate-generated-blobs.md: imports the build-time mermaid runtime.
import { mermaidRuntimeHtml } from "@getrambla/generated/mermaid-runtime-html";

describe("Mermaid runtime document", () => {
  it("ships a closed network policy", () => {
    expect(mermaidRuntimeHtml).toContain("default-src 'none'");
    expect(mermaidRuntimeHtml).toContain("connect-src 'none'");
    expect(mermaidRuntimeHtml).toContain("img-src data: blob:");
    expect(mermaidRuntimeHtml).toContain("font-src 'none'");
    expect(mermaidRuntimeHtml).toContain("frame-src 'none'");
  });
});
