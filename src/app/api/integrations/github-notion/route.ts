import {
  loadGitHubNotionConfig,
  publicGitHubNotionConfig,
  saveGitHubNotionConfig,
} from "@/src/lib/integrations/github-notion";
import { handleError, ok } from "@/src/lib/http";

export async function GET() {
  return ok({ config: publicGitHubNotionConfig(await loadGitHubNotionConfig()) });
}

export async function POST(request: Request) {
  try {
    return ok({ config: await saveGitHubNotionConfig(await request.json()) });
  } catch (error) {
    return handleError(error);
  }
}
