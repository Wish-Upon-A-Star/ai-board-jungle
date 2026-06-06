import { createSession, hashPassword } from "@/src/lib/auth";
import { fail, handleError, ok } from "@/src/lib/http";
import { createUser, findUserByEmail } from "@/src/lib/repository";
import { registerSchema } from "@/src/lib/validation";

export async function POST(request: Request) {
  try {
    const input = registerSchema.parse(await request.json());
    const exists = await findUserByEmail(input.email);
    if (exists) return fail("이미 가입된 이메일입니다.", 409);
    const user = await createUser({ email: input.email, name: input.name, passwordHash: await hashPassword(input.password) });
    await createSession(user);
    return ok({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }, 201);
  } catch (error) {
    return handleError(error);
  }
}
