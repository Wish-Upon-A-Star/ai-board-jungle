import { currentUser } from "@/src/lib/auth";
import { fail, handleError, ok } from "@/src/lib/http";
import { attachTags } from "@/src/lib/posts";
import { deletePost, getPost, updatePost } from "@/src/lib/repository";
import { normalizeTags, postSchema } from "@/src/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const post = await getPost(id);
    if (!post) return fail("게시글을 찾을 수 없습니다.", 404);
    return ok({ post });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const user = await currentUser();
    if (!user) return fail("로그인이 필요합니다.", 401);
    const { id } = await params;
    const post = await getPost(id);
    if (!post) return fail("게시글을 찾을 수 없습니다.", 404);
    if (post.authorId !== user.id && user.role !== "ADMIN") return fail("수정 권한이 없습니다.", 403);
    const raw = await request.json();
    const input = postSchema.parse({ ...raw, tags: normalizeTags(raw.tags) });
    const updated = await updatePost(id, { title: input.title, content: input.content });
    await attachTags(id, input.tags);
    return ok({ post: updated });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await currentUser();
    if (!user) return fail("로그인이 필요합니다.", 401);
    const { id } = await params;
    const post = await getPost(id);
    if (!post) return fail("게시글을 찾을 수 없습니다.", 404);
    if (post.authorId !== user.id && user.role !== "ADMIN") return fail("삭제 권한이 없습니다.", 403);
    await deletePost(id);
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
