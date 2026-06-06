import { getWeatherBrief } from "@/src/lib/ai/mcp-client";
import { chatJSON } from "@/src/lib/ai/provider";
import { handleError, ok } from "@/src/lib/http";

export async function POST() {
  try {
    const weather = await getWeatherBrief("Seoul");
    const generated = await chatJSON(
      "Return JSON: {\"draft\":\"Korean board post draft under 500 chars\"}.",
      JSON.stringify(weather),
      { draft: `[MCP 날씨 브리핑]\n${weather.summary}\n출처: ${weather.source}` },
    );
    return ok({ ...weather, ...generated });
  } catch (error) {
    return handleError(error);
  }
}
