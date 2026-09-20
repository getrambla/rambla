import { z } from "zod";

/** One dictated segment. `index` is assigned when the daemon cuts the segment, so segments
 * sort into the daemon's order even when a slow final arrives after a later segment's partial. */
export const DictationSegmentSchema = z.object({
  id: z.string(),
  index: z.number().int(),
  text: z.string(),
  isFinal: z.boolean(),
});

export type DictationSegment = z.infer<typeof DictationSegmentSchema>;
