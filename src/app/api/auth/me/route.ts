import { currentUser } from "@/src/lib/auth";
import { ok } from "@/src/lib/http";

export async function GET() {
  return ok({ user: await currentUser() });
}
