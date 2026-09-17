import { describe, expect, it } from "vitest";

import { createVolumeThrottle, pcm16ToBase64 } from "./dictation-source.web";

describe("dictation audio encoding", () => {
  it("encodes PCM16 as the base64 the daemon decodes", () => {
    const pcm = new Int16Array([0, 1, -1, 256, -32_768, 32_767]);

    expect(pcm16ToBase64(pcm)).toBe(Buffer.from(pcm.buffer).toString("base64"));
  });

  it("encodes a view that does not start at its buffer", () => {
    const backing = new Int16Array([9, 9, 1, 2, 3]);
    const pcm = backing.subarray(2);

    expect(pcm16ToBase64(pcm)).toBe(
      Buffer.from(new Int16Array([1, 2, 3]).buffer).toString("base64"),
    );
  });

  it("encodes an empty segment as an empty string", () => {
    expect(pcm16ToBase64(new Int16Array(0))).toBe("");
  });
});

describe("dictation volume throttle", () => {
  it("passes one update per interval so the composer does not re-render per message", () => {
    let now = 1_000;
    const allow = createVolumeThrottle(100, () => now);

    const accepted: number[] = [];
    // The worklet reports about every 43 ms; a second of that is 23 messages.
    for (let elapsed = 0; elapsed < 1_000; elapsed += 43) {
      now = 1_000 + elapsed;
      if (allow()) {
        accepted.push(elapsed);
      }
    }

    expect(accepted).toEqual([0, 129, 258, 387, 516, 645, 774, 903]);
  });

  it("passes the first update immediately", () => {
    const allow = createVolumeThrottle(100, () => 0);

    expect(allow()).toBe(true);
    expect(allow()).toBe(false);
  });
});
