import pino from "pino";

export interface CapturedLogLine {
  level: {
    label: string | undefined;
    value: number;
  };
  message: string | undefined;
  details: Record<string, unknown>;
}

export interface CreateCaptureLoggerResult {
  logger: pino.Logger;
  calls: CapturedLogLine[];
}

export function createCaptureLogger(): CreateCaptureLoggerResult {
  const calls: CapturedLogLine[] = [];
  const logger = pino(
    { level: "trace" },
    {
      write(chunk: string) {
        const parsed: { level: number; msg: string } & Record<string, unknown> = JSON.parse(chunk);
        const { level, msg, ...details } = parsed;
        calls.push({
          level: { label: pino.levels.labels[level], value: level },
          message: msg,
          details,
        });
      },
    },
  );
  return { logger, calls };
}
