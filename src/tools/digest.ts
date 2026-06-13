export async function write_digest_page(args: Record<string, unknown>) {
  const { date, content, covered_task_ids } = args as {
    date: string;
    content: string;
    covered_task_ids: string[];
  };

  console.log("[notion] create_page digest for:", date);
  // TODO(Railway): replace with actual Notion MCP call
  // mcp__notion__create_page({ parent: { page_id: NOTION_DIGESTS_PAGE_ID }, title: date, content })
  const notion_page_id = "notion-digest-placeholder-id";

  return { date, notion_page_id, covered_task_ids };
}
