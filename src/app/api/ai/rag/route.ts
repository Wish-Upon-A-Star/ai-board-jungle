import { answerFromKnowledgeBase, recommendSimilarPosts } from "@/src/lib/ai/rag";
import { handleError, ok } from "@/src/lib/http";
import { z } from "zod";

const schema = z.object({ question: z.string().min(1).max(2000) });

export async function POST(request: Request) {
  try {
    const { question } = schema.parse(await request.json());
    const [answer, recommendations] = await Promise.all([answerFromKnowledgeBase(question), recommendSimilarPosts(question)]);
    return ok({ answer, recommendations });
  } catch (error) {
    return handleError(error);
  }
}
