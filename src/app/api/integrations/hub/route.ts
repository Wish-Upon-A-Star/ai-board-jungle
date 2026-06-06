import { handleError, ok } from "@/src/lib/http";
import { loadHubConfig, publicHubConfig, saveHubConfig } from "@/src/lib/integrations/action-hub";

export async function GET() {
  return ok({ config: publicHubConfig(await loadHubConfig()) });
}

export async function POST(request: Request) {
  try {
    return ok({ config: await saveHubConfig(await request.json()) });
  } catch (error) {
    return handleError(error);
  }
}
