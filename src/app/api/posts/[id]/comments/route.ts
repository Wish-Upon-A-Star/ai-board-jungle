import { currentUser } from "@/src/lib/auth";
import { fail, handleError, ok } from "@/src/lib/http";
import { addComment } from "@/src/lib/repository";
import { commentSchema } from "@/src/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await currentUser();
    if (!user) return fail("로그인이 필요합니다.", 401);
    const { id } = await params;
    const input = commentSchema.parse(await request.json());
    const comment = await addComment({ content: input.content, postId: id, authorId: user.id });
    return ok({ comment }, 201);
  } catch (error) {
    return handleError(error);
  }
}
