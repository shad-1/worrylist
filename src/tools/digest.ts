import { getNotion, richText } from "../notion/client";
import { markdownToBlocks } from "../notion/markdown";

export async function write_digest_page(args: Record<string, unknown>) {
  const { date, content, covered_task_ids } = args as {
    date: string;
    content: string;
    covered_task_ids: string[];
  };

  const parentPageId = process.env.NOTION_DIGESTS_PAGE_ID;
  if (!parentPageId) throw new Error("NOTION_DIGESTS_PAGE_ID must be set");

  const page = await getNotion().pages.create({
    parent: { page_id: parentPageId },
    properties: {
      title: { title: richText(date) },
    } as never,
    children: markdownToBlocks(content) as never,
  });

  return { date, notion_page_id: page.id, covered_task_ids };
}
