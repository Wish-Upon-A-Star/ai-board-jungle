import { createServer } from "node:http";

type RpcRequest = { jsonrpc: "2.0"; id: string; method: string; params?: Record<string, unknown> };
type RpcResponse = { jsonrpc: "2.0"; id: string; result?: unknown; error?: { code: number; message: string } };

const locations: Record<string, { latitude: number; longitude: number }> = {
  Seoul: { latitude: 37.5665, longitude: 126.978 },
  Busan: { latitude: 35.1796, longitude: 129.0756 },
  Incheon: { latitude: 37.4563, longitude: 126.7052 },
};

async function weatherLookup(params: Record<string, unknown>) {
  const location = String(params.location || "Seoul");
  const point = locations[location] || locations.Seoul;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${point.latitude}&longitude=${point.longitude}&current_weather=true`;
  const response = await fetch(url);
  const data = await response.json();
  const current = data.current_weather || {};
  return {
    location,
    temperature: Number(current.temperature ?? 0),
    windspeed: Number(current.windspeed ?? 0),
    summary: `${location} 현재 기온은 ${current.temperature ?? "?"}도, 풍속은 ${current.windspeed ?? "?"}km/h입니다.`,
    source: "open-meteo",
  };
}

async function urlMetadata(params: Record<string, unknown>) {
  const url = String(params.url || "");
  if (!/^https?:\/\//.test(url)) throw new Error("url must start with http or https");
  const response = await fetch(url);
  const html = await response.text();
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || url;
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() || "";
  return { url, title, description };
}

async function dispatch(request: RpcRequest): Promise<RpcResponse> {
  try {
    if (request.jsonrpc !== "2.0") throw new Error("invalid jsonrpc version");
    if (request.method === "weather.lookup") {
      return { jsonrpc: "2.0", id: request.id, result: await weatherLookup(request.params || {}) };
    }
    if (request.method === "url.metadata") {
      return { jsonrpc: "2.0", id: request.id, result: await urlMetadata(request.params || {}) };
    }
    return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "method not found" } };
  } catch (error) {
    return { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : "server error" } };
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/rpc") {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", async () => {
    const response = await dispatch(JSON.parse(body));
    res.writeHead(response.error ? 400 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  });
});

const port = Number(process.env.MCP_PORT || 8788);
server.listen(port, () => {
  console.log(`MCP JSON-RPC server listening on http://127.0.0.1:${port}/rpc`);
});
