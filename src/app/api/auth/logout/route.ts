import { clearSession } from "@/src/lib/auth";
import { ok } from "@/src/lib/http";

export async function POST() {
  await clearSession();
  return ok({ ok: true });
}
