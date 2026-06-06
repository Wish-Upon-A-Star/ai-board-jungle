import { handleError, ok } from "@/src/lib/http";
import { runInstructionHub } from "@/src/lib/integrations/action-hub";
import { z } from "zod";

const schema = z.object({ instruction: z.string().min(1).max(4000) });

export async function POST(request: Request) {
  try {
    const { instruction } = schema.parse(await request.json());
    return ok(await runInstructionHub(instruction));
  } catch (error) {
    return handleError(error);
  }
}
