import { describe, expect, it } from "vitest";
import { DictationStreamPartialMessageSchema } from "../../src/messages.js";
import { validateWSOutboundMessage } from "../../src/validation/ws-outbound.js";

const partialWithoutSegment = {
  type: "dictation_stream_partial" as const,
  payload: { dictationId: "d1", text: "hello world" },
};

const partialWithSegment = {
  type: "dictation_stream_partial" as const,
  payload: {
    dictationId: "d1",
    text: "",
    segment: { id: "seg-1", index: 2, text: "hello world", isFinal: false },
  },
};

describe("dictation partial segments", () => {
  it("parses a partial without a segment", () => {
    expect(DictationStreamPartialMessageSchema.parse(partialWithoutSegment)).toEqual(
      partialWithoutSegment,
    );
  });

  it("parses a partial carrying one segment", () => {
    expect(DictationStreamPartialMessageSchema.parse(partialWithSegment)).toEqual(
      partialWithSegment,
    );
  });

  it("round-trips a segment through the generated outbound validator", () => {
    const envelope = { type: "session", message: partialWithSegment };
    expect(validateWSOutboundMessage(envelope)).toEqual({ success: true, data: envelope });
  });

  it("round-trips a partial without a segment through the generated outbound validator", () => {
    const envelope = { type: "session", message: partialWithoutSegment };
    expect(validateWSOutboundMessage(envelope)).toEqual({ success: true, data: envelope });
  });

  // The generated validator carries unknown keys through untouched, so this is what
  // proves the field is in the generated schema rather than riding along as extra.
  it("rejects a partial whose segment index is not a number", () => {
    const envelope = {
      type: "session",
      message: {
        type: "dictation_stream_partial",
        payload: {
          dictationId: "d1",
          text: "",
          segment: { id: "seg-1", index: "2", text: "hello", isFinal: false },
        },
      },
    };
    expect(validateWSOutboundMessage(envelope).success).toBe(false);
  });
});
