import { describe, expect, it } from "vitest";
import { parseReleaseAssetUrl } from "./downloads";

describe("parseReleaseAssetUrl", () => {
  it("accepts a Rambla release file", () => {
    const url =
      "https://github.com/getrambla/rambla/releases/download/v0.10.3/Rambla-0.10.3-arm64.dmg";
    expect(parseReleaseAssetUrl(url)).toBe(url);
  });

  it("rejects a path that climbs into another repository's releases", () => {
    expect(
      parseReleaseAssetUrl(
        "https://github.com/getrambla/rambla/releases/download/v1/../../../../evil/repo/releases/download/v1/app.dmg",
      ),
    ).toBeNull();
    expect(
      parseReleaseAssetUrl(
        "https://github.com/getrambla/rambla/releases/download/v1/%2e%2e/%2e%2e/%2e%2e/%2e%2e/evil/repo/app.dmg",
      ),
    ).toBeNull();
  });

  it("rejects other hosts and malformed values", () => {
    expect(
      parseReleaseAssetUrl(
        "https://github.com.evil.test/getrambla/rambla/releases/download/v1/a.dmg",
      ),
    ).toBeNull();
    expect(
      parseReleaseAssetUrl("http://github.com/getrambla/rambla/releases/download/v1/a.dmg"),
    ).toBeNull();
    expect(parseReleaseAssetUrl("not a url")).toBeNull();
    expect(parseReleaseAssetUrl(undefined)).toBeNull();
  });
});
