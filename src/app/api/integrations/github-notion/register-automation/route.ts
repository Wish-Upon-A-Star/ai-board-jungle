import { loadGitHubNotionConfig, saveGitHubNotionConfig } from "@/src/lib/integrations/github-notion";
import { handleError, ok } from "@/src/lib/http";

export async function POST() {
  try {
    const config = await loadGitHubNotionConfig();
    const updated = await saveGitHubNotionConfig({
      autoSyncEnabled: true,
      intervalMinutes: config.intervalMinutes || 30,
      lastRegisteredAt: new Date().toISOString(),
    });
    return ok({
      config: updated,
      message: "Local automation flag registered. Codex cron automation should run npm run verify:auto for full checks.",
    });
  } catch (error) {
    return handleError(error);
  }
}
