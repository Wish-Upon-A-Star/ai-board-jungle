import { moderatePostAgent } from "@/src/lib/ai/agent";
import { handleError, ok } from "@/src/lib/http";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(8000),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return ok(await moderatePostAgent(input.title, input.content));
  } catch (error) {
    return handleError(error);
  }
}
