export type WeatherBrief = {
  location: string;
  temperature: number;
  windspeed: number;
  summary: string;
  source: string;
};

type JsonRpcResponse<T> = { jsonrpc: "2.0"; id: string; result?: T; error?: { code: number; message: string } };

export async function callMcp<T>(method: string, params: unknown): Promise<T> {
  const url = process.env.MCP_SERVER_URL;
  if (!url) {
    throw new Error("MCP_SERVER_URL is not configured");
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
    cache: "no-store",
  });
  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || "MCP request failed");
  }
  return payload.result as T;
}

export async function getWeatherBrief(location = "Seoul"): Promise<WeatherBrief> {
  try {
    return await callMcp<WeatherBrief>("weather.lookup", { location });
  } catch {
    const response = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current_weather=true",
      { cache: "no-store" },
    );
    const data = await response.json();
    const current = data.current_weather || {};
    return {
      location,
      temperature: Number(current.temperature ?? 0),
      windspeed: Number(current.windspeed ?? 0),
      summary: `${location} 현재 기온은 ${current.temperature ?? "?"}도, 풍속은 ${current.windspeed ?? "?"}km/h입니다.`,
      source: "open-meteo fallback",
    };
  }
}
