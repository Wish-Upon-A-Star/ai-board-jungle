import { syncGitHubNotion } from "@/src/lib/integrations/github-notion";
import { handleError, ok } from "@/src/lib/http";

export async function POST() {
  try {
    return ok({ accepted: true, summary: await syncGitHubNotion() });
  } catch (error) {
    return handleError(error);
  }
}
