import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";

import type { StreamingTranscriptionSession } from "../../../speech-provider.js";
import { pcm16lePeakAbs, pcm16leToFloat32 } from "../../../audio.js";
import { SherpaOfflineRecognizerEngine } from "./sherpa-offline-recognizer.js";

export class SherpaParakeetRealtimeTranscriptionSession
  extends EventEmitter
  implements StreamingTranscriptionSession
{
  private readonly engine: SherpaOfflineRecognizerEngine;
  private connected = false;

  public readonly requiredSampleRate: number;
  private currentSegmentId: string | null = null;
  // RAMBLA-FORK: feature: 2026-09-20-feat-live-dictation-text-in-field.md: numbers segments in cut order.
  private currentSegmentIndex = 0;
  private previousSegmentId: string | null = null;
  private lastPartialText = "";

  private pcm16: Buffer = Buffer.alloc(0);
  private lastDecodeAt = 0;
  private decoding = false;
  private pendingDecode = false;
  private readonly minDecodeIntervalMs: number;

  constructor(params: { engine: SherpaOfflineRecognizerEngine; minDecodeIntervalMs?: number }) {
    super();
    this.engine = params.engine;
    this.requiredSampleRate = this.engine.sampleRate;
    this.minDecodeIntervalMs = params.minDecodeIntervalMs ?? 350;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.currentSegmentId = uuidv4();
    // RAMBLA-FORK: feature: 2026-09-20-feat-live-dictation-text-in-field.md: resets segment numbering on connect.
    this.currentSegmentIndex = 0;
    this.connected = true;
  }

  appendPcm16(chunk: Buffer): void {
    if (!this.connected || !this.currentSegmentId) {
      this.emit("error", new Error("Parakeet realtime session not connected"));
      return;
    }

    try {
      this.pcm16 = this.pcm16.length === 0 ? chunk : Buffer.concat([this.pcm16, chunk]);
      void this.maybeDecode(false);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  commit(): void {
    if (!this.connected || !this.currentSegmentId) {
      this.emit("error", new Error("Parakeet realtime session not connected"));
      return;
    }

    // RAMBLA-FORK: fix: 2026-09-16-fix-dictation-loss.md: commit() bounds the segment synchronously, then decodes that snapshot.
    // The segment ends here, synchronously. Audio appended after this call — in
    // the same tick or later — belongs to the next segment, so a decode that
    // resolves afterwards cannot pull it into this transcript.
    const segmentId = this.currentSegmentId;
    // RAMBLA-FORK: feature: 2026-09-20-feat-live-dictation-text-in-field.md: captures the committed segment's index.
    const index = this.currentSegmentIndex;
    const previousSegmentId = this.previousSegmentId;
    const audio = this.pcm16;
    this.previousSegmentId = segmentId;
    this.currentSegmentId = uuidv4();
    // RAMBLA-FORK: feature: 2026-09-20-feat-live-dictation-text-in-field.md: advances the index in the same block that cuts.
    this.currentSegmentIndex += 1;
    this.lastPartialText = "";
    this.pcm16 = Buffer.alloc(0);

    void (async () => {
      try {
        // RAMBLA-FORK: fix: 2026-09-16-fix-dictation-loss.md: the final decodes this segment's own audio snapshot.
        // A fresh decode over exactly this segment's audio: a decode still in
        // flight covers a different buffer and its text is never shipped final.
        const finalText = await this.decodePcm16(audio);

        this.emit("committed", { segmentId, previousSegmentId });
        // RAMBLA-FORK: feature: 2026-09-20-feat-live-dictation-text-in-field.md: final carries the segment index.
        this.emit("transcript", { segmentId, index, transcript: finalText, isFinal: true });
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    })();
  }

  clear(): void {
    if (!this.connected) {
      return;
    }
    this.pcm16 = Buffer.alloc(0);
    this.currentSegmentId = uuidv4();
    // RAMBLA-FORK: feature: 2026-09-20-feat-live-dictation-text-in-field.md: clear starts a new numbered segment.
    this.currentSegmentIndex += 1;
    this.lastPartialText = "";
  }

  close(): void {
    this.connected = false;
    this.currentSegmentId = null;
    this.pcm16 = Buffer.alloc(0);
  }

  private async maybeDecode(force: boolean): Promise<void> {
    if (!this.connected || !this.currentSegmentId) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastDecodeAt < this.minDecodeIntervalMs) {
      return;
    }

    if (this.decoding) {
      this.pendingDecode = true;
      return;
    }

    this.decoding = true;
    // RAMBLA-FORK: fix: 2026-09-16-fix-dictation-loss.md: decodes a snapshot and drops text for a segment already committed.
    const decodedSegmentId = this.currentSegmentId;
    const audio = this.pcm16;
    try {
      // RAMBLA-FORK: fix: 2026-09-16-fix-dictation-loss.md: decodes the snapshot taken above.
      const text = await this.decodePcm16(audio);
      this.lastDecodeAt = Date.now();
      // RAMBLA-FORK: fix: 2026-09-16-fix-dictation-loss.md: drops partial text for a segment a commit already ended.
      // A commit may have ended that segment while this decode ran; its text
      // describes audio that has already shipped, so it must not land here.
      if (decodedSegmentId !== this.currentSegmentId) {
        return;
      }
      if (text !== this.lastPartialText) {
        this.lastPartialText = text;
        this.emit("transcript", {
          segmentId: this.currentSegmentId,
          // RAMBLA-FORK: feature: 2026-09-20-feat-live-dictation-text-in-field.md: partial carries the segment index.
          index: this.currentSegmentIndex,
          transcript: text,
          isFinal: false,
        });
      }
    } finally {
      this.decoding = false;
      if (this.pendingDecode) {
        this.pendingDecode = false;
        await this.maybeDecode(true);
      }
    }
  }

  // RAMBLA-FORK: fix: 2026-09-16-fix-dictation-loss.md: decodes the given buffer instead of the live one.
  private async decodePcm16(pcm16: Buffer): Promise<string> {
    if (pcm16.length === 0) {
      return "";
    }

    // RAMBLA-FORK: fix: 2026-09-16-fix-dictation-loss.md: reads the given buffer.
    const peak = pcm16lePeakAbs(pcm16);
    const peakFloat = peak / 32768.0;
    const targetPeak = 0.6;
    const maxGain = 50;
    const gain =
      peakFloat > 0 && peakFloat < targetPeak ? Math.min(maxGain, targetPeak / peakFloat) : 1;

    const stream = this.engine.createStream();
    try {
      // RAMBLA-FORK: fix: 2026-09-16-fix-dictation-loss.md: reads the given buffer.
      const floatSamples = pcm16leToFloat32(pcm16, gain);
      this.engine.acceptWaveform(stream, this.engine.sampleRate, floatSamples);
      this.engine.recognizer.decode(stream);
      const result = this.engine.recognizer.getResult(stream);
      return String(
        (typeof result === "object" && result && "text" in result ? result.text : undefined) ??
          result ??
          "",
      ).trim();
    } finally {
      try {
        stream.free?.();
      } catch {
        // ignore
      }
    }
  }
}
