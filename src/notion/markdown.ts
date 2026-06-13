import { richText } from "./client";

export type NotionBlock = Record<string, unknown>;

// Minimal markdown → Notion block conversion for digest pages. Handles the
// subset the digest prompt produces: H1–H3, bullet and numbered lists, and
// paragraphs. Blank lines are dropped. Notion caps children at 100 blocks per
// request, so the result is truncated to stay within that limit.
export function markdownToBlocks(md: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  for (const raw of (md ?? "").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;

    let m: RegExpMatchArray | null;
    if ((m = line.match(/^###\s+(.*)/))) {
      blocks.push({ type: "heading_3", heading_3: { rich_text: richText(m[1]) } });
    } else if ((m = line.match(/^##\s+(.*)/))) {
      blocks.push({ type: "heading_2", heading_2: { rich_text: richText(m[1]) } });
    } else if ((m = line.match(/^#\s+(.*)/))) {
      blocks.push({ type: "heading_1", heading_1: { rich_text: richText(m[1]) } });
    } else if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      blocks.push({ type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(m[1]) } });
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) {
      blocks.push({ type: "numbered_list_item", numbered_list_item: { rich_text: richText(m[1]) } });
    } else {
      blocks.push({ type: "paragraph", paragraph: { rich_text: richText(line) } });
    }
  }

  return blocks.slice(0, 100);
}
