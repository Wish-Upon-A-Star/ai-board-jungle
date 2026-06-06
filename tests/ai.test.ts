import { describe, expect, it } from "vitest";
import { lexicalScore } from "../src/lib/ai/rag";
import { parseGitHubRepoUrl, parseNotionDatabaseId } from "../src/lib/integrations/github-notion";
import { normalizeTags, postSchema } from "../src/lib/validation";

describe("AI board pure logic", () => {
  it("scores similar Korean board text higher than unrelated text", () => {
    const query = "RAG 유사 게시글 추천";
    expect(lexicalScore(query, "RAG 유사 게시글 자동 추천 기능")).toBeGreaterThan(
      lexicalScore(query, "날씨 브리핑 외부 데이터"),
    );
  });

  it("normalizes tags with duplicates and hash prefixes", () => {
    expect(normalizeTags(["#rag", "rag", " mcp "])).toEqual(["rag", "mcp"]);
  });

  it("validates minimum post content", () => {
    expect(() => postSchema.parse({ title: "abc", content: "short", tags: [] })).toThrow();
  });

  it("parses GitHub and Notion integration links", () => {
    expect(parseGitHubRepoUrl("https://github.com/octocat/Hello-World").full).toBe("octocat/Hello-World");
    expect(parseNotionDatabaseId("https://www.notion.so/acme/Tasks-12345678123412341234123456789abc")).toBe(
      "12345678123412341234123456789abc",
    );
  });
});
