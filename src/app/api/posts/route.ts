import { currentUser } from "@/src/lib/auth";
import { fail, handleError, ok } from "@/src/lib/http";
import { createPostWithAi } from "@/src/lib/posts";
import { listPosts } from "@/src/lib/repository";
import { normalizeTags, postSchema } from "@/src/lib/validation";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const q = (searchParams.get("q") || "").trim();
    const take = 6;
    return ok(await listPosts(q, page, take));
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return fail("로그인이 필요합니다.", 401);
    const raw = await request.json();
    const input = postSchema.parse({ ...raw, tags: normalizeTags(raw.tags) });
    const result = await createPostWithAi({ ...input, authorId: user.id });
    return ok(result, 201);
  } catch (error) {
    return handleError(error);
  }
}
