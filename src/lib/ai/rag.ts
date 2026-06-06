import { prisma } from "../db";
import { isDemoStoreEnabled } from "../demo-store";
import { allPublishedPosts } from "../repository";
import { chatJSON, embedText } from "./provider";

export type RagRecommendation = {
  id: string;
  title: string;
  score: number;
  summary: string;
  tags: string[];
};

function tokenize(text: string) {
  return Array.from(new Set(text.toLowerCase().match(/[a-z0-9가-힣]+/g) || []));
}

export function lexicalScore(query: string, doc: string) {
  const q = tokenize(query);
  const d = new Set(tokenize(doc));
  if (q.length === 0) return 0;
  return q.filter((token) => d.has(token)).length / q.length;
}

export async function summarizeForBoard(title: string, content: string) {
  return chatJSON(
    "Return JSON: {\"summary\":\"short Korean summary under 120 chars\"}.",
    `${title}\n\n${content}`,
    { summary: content.replace(/\s+/g, " ").slice(0, 110) },
  );
}

export async function recommendSimilarPosts(query: string): Promise<RagRecommendation[]> {
  const embedding = await embedText(query);
  if (embedding && !isDemoStoreEnabled()) {
    try {
      const vector = `[${embedding.join(",")}]`;
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string; title: string; summary: string; score: number }>>(
        `SELECT id, title, summary, 1 - (embedding <=> $1::vector) AS score
         FROM "Post"
         WHERE embedding IS NOT NULL AND status = 'PUBLISHED'
         ORDER BY embedding <=> $1::vector
         LIMIT 5`,
        vector,
      );
      if (rows.length) {
        return rows.map((row) => ({ ...row, tags: [] }));
      }
    } catch (error) {
      console.warn("pgvector search fallback used", error);
    }
  }

  const posts = await allPublishedPosts();
  return posts
    .map((post) => ({
      id: post.id,
      title: post.title,
      score: lexicalScore(query, `${post.title} ${post.content} ${post.tags.map((t) => t.tag.name).join(" ")}`),
      summary: post.summary || post.content.slice(0, 120),
      tags: post.tags.map((t) => t.tag.name),
    }))
    .filter((post) => post.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export async function answerFromKnowledgeBase(question: string) {
  const hits = await recommendSimilarPosts(question);
  return chatJSON(
    "Return JSON: {\"answer\":\"Korean answer grounded in context\",\"sources\":[\"post title\"]}. Never invent sources.",
    `Question: ${question}\nContext:\n${hits.map((hit) => `- ${hit.title}: ${hit.summary}`).join("\n")}`,
    {
      answer:
        hits.length > 0
          ? `관련 게시글 ${hits[0].title}를 먼저 확인하세요. ${hits[0].summary}`
          : "아직 게시판 지식 베이스에서 충분한 근거를 찾지 못했습니다.",
      sources: hits.map((hit) => hit.title),
    },
  );
}
