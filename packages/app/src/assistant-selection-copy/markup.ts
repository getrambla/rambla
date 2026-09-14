export const MARKDOWN_COPY_TAG_ATTRIBUTE = "data-rambla-markdown-tag";
export const MARKDOWN_COPY_IGNORE_ATTRIBUTE = "data-rambla-markdown-ignore";
export const MARKDOWN_COPY_LIST_MARKER_ATTRIBUTE = "data-rambla-markdown-list-marker";
export const MARKDOWN_COPY_UNWRAP_ATTRIBUTE = "data-rambla-markdown-unwrap";
export const MARKDOWN_COPY_LIST_START_ATTRIBUTE = "data-rambla-markdown-list-start";
export const MARKDOWN_COPY_LANGUAGE_ATTRIBUTE = "data-rambla-markdown-language";
export const MARKDOWN_COPY_ALIGN_ATTRIBUTE = "data-rambla-markdown-align";

/**
 * Trailing line breaks, with any indentation that followed the last one.
 *
 * Both ways of copying code strip these, for the same reason: pasting a trailing
 * newline into a terminal runs the last line. A fence body always ends in one, and
 * ends in several when the author left blank lines before the closing fence; a
 * selection picks one up whenever it overshoots the end of a rendered line.
 */
export const TRAILING_CODE_LINE_BREAKS = /(\r?\n[ \t]*)+$/;

export const markdownCopyDataSet = {
  blockquote: { ramblaMarkdownTag: "blockquote" },
  br: { ramblaMarkdownTag: "br" },
  code: { ramblaMarkdownTag: "code" },
  h1: { ramblaMarkdownTag: "h1" },
  h2: { ramblaMarkdownTag: "h2" },
  h3: { ramblaMarkdownTag: "h3" },
  h4: { ramblaMarkdownTag: "h4" },
  h5: { ramblaMarkdownTag: "h5" },
  h6: { ramblaMarkdownTag: "h6" },
  hr: { ramblaMarkdownTag: "hr" },
  ignore: { ramblaMarkdownIgnore: "true" },
  li: { ramblaMarkdownTag: "li" },
  listMarker: { ramblaMarkdownIgnore: "true", ramblaMarkdownListMarker: "true" },
  ol: { ramblaMarkdownTag: "ol" },
  p: { ramblaMarkdownTag: "p" },
  pre: { ramblaMarkdownTag: "pre" },
  s: { ramblaMarkdownTag: "s" },
  strong: { ramblaMarkdownTag: "strong" },
  em: { ramblaMarkdownTag: "em" },
  table: { ramblaMarkdownTag: "table" },
  tbody: { ramblaMarkdownTag: "tbody" },
  td: { ramblaMarkdownTag: "td" },
  th: { ramblaMarkdownTag: "th" },
  thead: { ramblaMarkdownTag: "thead" },
  tr: { ramblaMarkdownTag: "tr" },
  ul: { ramblaMarkdownTag: "ul" },
  unwrap: { ramblaMarkdownUnwrap: "true" },
} as const;

export type MarkdownCopyInlineTag = "br" | "code" | "em" | "s" | "strong";

export function markdownCopyOrderedListDataSet(start: unknown) {
  return {
    ...markdownCopyDataSet.ol,
    ramblaMarkdownListStart: String(start ?? 1),
  } as const;
}

export function markdownCopyCodeBlockDataSet(language: string | null | undefined) {
  const fenceLanguage = language?.trim().split(/\s+/)[0];
  return {
    ...markdownCopyDataSet.pre,
    ...(fenceLanguage ? { ramblaMarkdownLanguage: fenceLanguage } : {}),
  } as const;
}

export function markdownCopyTableCellDataSet(tag: "td" | "th", style: unknown) {
  const alignment =
    typeof style === "string"
      ? style.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center)/i)?.[1]
      : null;
  return {
    ...markdownCopyDataSet[tag],
    ...(alignment ? { ramblaMarkdownAlign: alignment.toLowerCase() } : {}),
  } as const;
}
