import { normalizeTags } from "./validation";
import { summarizeForBoard } from "./ai/rag";
import { moderatePostAgent } from "./ai/agent";
import { attachPostTags, createPost } from "./repository";

export async function attachTags(postId: string, tags: string[]) {
  await attachPostTags(postId, normalizeTags(tags));
}

export async function createPostWithAi(input: { title: string; content: string; tags: string[]; authorId: string }) {
  const [summary, moderation] = await Promise.all([
    summarizeForBoard(input.title, input.content),
    moderatePostAgent(input.title, input.content),
  ]);
  const post = await createPost({
    title: input.title,
    content: input.content,
    summary: summary.summary,
    status: moderation.decision === "hold" ? "HELD" : "PUBLISHED",
    authorId: input.authorId,
  });
  await attachTags(post.id, [...input.tags, ...moderation.suggestedTags]);
  return { post, moderation };
}
