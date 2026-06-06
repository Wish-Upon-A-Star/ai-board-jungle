import { createSession, verifyPassword } from "@/src/lib/auth";
import { fail, handleError, ok } from "@/src/lib/http";
import { findUserByEmail } from "@/src/lib/repository";
import { loginSchema } from "@/src/lib/validation";

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await request.json());
    const user = await findUserByEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      return fail("이메일 또는 비밀번호가 올바르지 않습니다.", 401);
    }
    await createSession(user);
    return ok({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    return handleError(error);
  }
}
