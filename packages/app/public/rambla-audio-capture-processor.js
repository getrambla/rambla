// Microphone capture for dictation and voice chat, running on the audio thread.
// Plain JavaScript with no imports: an AudioWorkletGlobalScope has no module
// resolution beyond addModule, and Metro must not bundle this file.

// `this.port` is a MessagePort, not a Window: its second argument is a transfer
// list, and assigning `onmessage` is how a worklet port starts delivering.
// oxlint-disable unicorn/require-post-message-target-origin, unicorn/prefer-add-event-listener

const DEFAULT_OUTPUT_SAMPLE_RATE = 16000;
const DEFAULT_SEGMENT_FRAMES = 16000;
const DEFAULT_VOLUME_EVERY_QUANTA = 16;
// Interpolating the first output frame of a quantum can reach back into the
// previous one, by up to half the resampling ratio.
const HISTORY_FRAMES = 8;

/** Converts one float sample to signed 16-bit PCM. */
function toInt16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

class RamblaAudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = (options && options.processorOptions) || {};
    this.outputSampleRate = config.outputSampleRate || DEFAULT_OUTPUT_SAMPLE_RATE;
    this.segmentFrames = config.segmentFrames || DEFAULT_SEGMENT_FRAMES;
    this.volumeEveryQuanta = config.volumeEveryQuanta || DEFAULT_VOLUME_EVERY_QUANTA;
    this.ratio = sampleRate / this.outputSampleRate;

    this.segment = new Int16Array(this.segmentFrames);
    this.segmentLength = 0;
    this.segmentFirstIndex = 0;
    this.nextFrameIndex = 0;

    this.history = new Float32Array(HISTORY_FRAMES);
    this.muted = false;
    this.sumSquares = 0;
    this.sampleCount = 0;
    this.quantaSinceVolume = 0;

    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  /** Handles the two messages a consumer sends: mute and flush. */
  handleMessage(data) {
    if (!data || typeof data !== "object") {
      return;
    }
    if (data.type === "mute") {
      this.muted = Boolean(data.muted);
      return;
    }
    if (data.type === "flush") {
      this.emitSegment();
      this.port.postMessage({
        type: "flushed",
        finalFrameIndex: this.nextFrameIndex,
        final: Boolean(data.final),
      });
    }
  }

  /** Reads an input sample, reaching into the previous quantum for negative indices. */
  readSample(channel, index) {
    if (index >= channel.length) {
      return channel[channel.length - 1];
    }
    if (index >= 0) {
      return channel[index];
    }
    const historyIndex = this.history.length + index;
    return historyIndex >= 0 ? this.history[historyIndex] : this.history[0];
  }

  /** Keeps the tail of this quantum so the next one can interpolate across the seam. */
  rememberTail(channel) {
    const count = Math.min(this.history.length, channel.length);
    this.history.copyWithin(0, count);
    this.history.set(channel.subarray(channel.length - count), this.history.length - count);
  }

  reportVolume(channel) {
    let sum = 0;
    for (let index = 0; index < channel.length; index += 1) {
      sum += channel[index] * channel[index];
    }
    this.sumSquares += sum;
    this.sampleCount += channel.length;
    this.quantaSinceVolume += 1;
    if (this.quantaSinceVolume < this.volumeEveryQuanta) {
      return;
    }
    const rms = this.sampleCount > 0 ? Math.sqrt(this.sumSquares / this.sampleCount) : 0;
    this.port.postMessage({ type: "volume", rms: rms > 1 ? 1 : rms });
    this.sumSquares = 0;
    this.sampleCount = 0;
    this.quantaSinceVolume = 0;
  }

  emitSegment() {
    if (this.segmentLength === 0) {
      return;
    }
    const pcm = this.segment.slice(0, this.segmentLength);
    this.port.postMessage(
      {
        type: "segment",
        pcm: pcm.buffer,
        frames: this.segmentLength,
        firstFrameIndex: this.segmentFirstIndex,
      },
      [pcm.buffer],
    );
    this.segmentLength = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // Output frames are placed by the audio clock rather than counted, so a
    // render the audio thread never ran leaves a gap in firstFrameIndex, and a
    // muted or disconnected stretch still moves the index a consumer flushes to.
    const startIndex = Math.round(currentFrame / this.ratio);
    if (!channel || channel.length === 0) {
      this.nextFrameIndex = startIndex;
      return true;
    }
    const endIndex = Math.round((currentFrame + channel.length) / this.ratio);
    this.nextFrameIndex = endIndex;

    this.reportVolume(channel);

    if (this.muted) {
      this.rememberTail(channel);
      return true;
    }

    for (let index = startIndex; index < endIndex; index += 1) {
      if (this.segmentLength === 0) {
        this.segmentFirstIndex = index;
      }
      const position = index * this.ratio - currentFrame;
      const floor = Math.floor(position);
      const first = this.readSample(channel, floor);
      const second = this.readSample(channel, floor + 1);
      this.segment[this.segmentLength] = toInt16(first + (second - first) * (position - floor));
      this.segmentLength += 1;
      if (this.segmentLength === this.segmentFrames) {
        this.emitSegment();
      }
    }
    this.rememberTail(channel);
    return true;
  }
}

registerProcessor("rambla-audio-capture", RamblaAudioCaptureProcessor);
