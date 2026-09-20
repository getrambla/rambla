import { describe, expect, it } from "vitest";
import { DictationStreamPartialMessageSchema } from "../../src/messages.js";
import { validateWSOutboundMessage } from "../../src/validation/ws-outbound.js";

const SEGMENT = { id: "seg-1", index: 0, text: "hello there", isFinal: false };

describe("dictation partial segments", () => {
  it("parses a partial without a segment", () => {
    const parsed = DictationStreamPartialMessageSchema.parse({
      type: "dictation_stream_partial",
      payload: { dictationId: "dictation-1", text: "hello there" },
    });

    expect(parsed.payload.segment).toBeUndefined();
    expect(parsed.payload.text).toBe("hello there");
  });

  it("parses a partial carrying one segment", () => {
    const parsed = DictationStreamPartialMessageSchema.parse({
      type: "dictation_stream_partial",
      payload: { dictationId: "dictation-1", text: "", segment: SEGMENT },
    });

    expect(parsed.payload.segment).toEqual(SEGMENT);
    expect(parsed.payload.text).toBe("");
  });

  it("round-trips a segment through the generated outbound validator", () => {
    const envelope = {
      type: "session",
      message: {
        type: "dictation_stream_partial",
        payload: {
          dictationId: "dictation-1",
          text: "",
          segment: { id: "seg-2", index: 3, text: "and then", isFinal: true },
        },
      },
    };

    expect(validateWSOutboundMessage(envelope)).toEqual({ success: true, data: envelope });
  });

  it("round-trips a partial without a segment through the generated outbound validator", () => {
    const envelope = {
      type: "session",
      message: {
        type: "dictation_stream_partial",
        payload: { dictationId: "dictation-1", text: "hello there" },
      },
    };

    expect(validateWSOutboundMessage(envelope)).toEqual({ success: true, data: envelope });
  });
});
