import { describe, it, expect } from "vitest";
import { markdownToBlocks } from "../../src/notion/markdown";

function text(block: Record<string, unknown>): string {
  const body = block[block.type as string] as { rich_text: Array<{ text: { content: string } }> };
  return body.rich_text.map((r) => r.text.content).join("");
}

describe("markdownToBlocks", () => {
  it("maps heading levels", () => {
    const blocks = markdownToBlocks("# H1\n## H2\n### H3");
    expect(blocks.map((b) => b.type)).toEqual(["heading_1", "heading_2", "heading_3"]);
    expect(text(blocks[0])).toBe("H1");
  });

  it("maps bullet and numbered list items", () => {
    const blocks = markdownToBlocks("- first\n* second\n1. third");
    expect(blocks.map((b) => b.type)).toEqual([
      "bulleted_list_item",
      "bulleted_list_item",
      "numbered_list_item",
    ]);
    expect(text(blocks[2])).toBe("third");
  });

  it("treats other lines as paragraphs and drops blank lines", () => {
    const blocks = markdownToBlocks("hello world\n\n\nnext para");
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.type === "paragraph")).toBe(true);
  });

  it("truncates to Notion's 100-block limit", () => {
    const md = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n");
    expect(markdownToBlocks(md)).toHaveLength(100);
  });
});
