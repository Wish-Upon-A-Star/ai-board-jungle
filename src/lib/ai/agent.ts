import { getWeatherBrief } from "./mcp-client";
import { chatJSON } from "./provider";
import { recommendSimilarPosts } from "./rag";

export type AgentState = {
  steps: Array<{ tool: string; observation: string }>;
  decision: "publish" | "hold" | "revise";
  reason: string;
  suggestedTags: string[];
};

function hasRiskyText(text: string) {
  return /(스팸|혐오|욕설|광고|도박|사기|꺼져|죽어)/i.test(text);
}

export async function moderatePostAgent(title: string, content: string): Promise<AgentState> {
  const steps: AgentState["steps"] = [];
  const similar = await recommendSimilarPosts(`${title}\n${content}`);
  steps.push({ tool: "rag.searchSimilarPosts", observation: `${similar.length} similar posts found` });

  const weatherNeeded = /날씨|기온|비|눈|태풍/.test(`${title} ${content}`);
  if (weatherNeeded) {
    const weather = await getWeatherBrief("Seoul");
    steps.push({ tool: "mcp.weather.lookup", observation: weather.summary });
  }

  const fallback: AgentState = {
    steps,
    decision: hasRiskyText(content) ? "hold" : similar[0]?.score > 0.75 ? "revise" : "publish",
    reason: hasRiskyText(content)
      ? "운영 정책상 위험 표현이 감지되어 보류가 필요합니다."
      : similar[0]?.score > 0.75
        ? "이미 유사한 게시글이 있어 중복 가능성을 안내합니다."
        : "위험 신호가 낮고 게시 가능 상태입니다.",
    suggestedTags: Array.from(new Set(similar.flatMap((item) => item.tags))).slice(0, 5),
  };

  const judged = await chatJSON<Omit<AgentState, "steps">>(
    "You are an autonomous board moderation agent. Return JSON with decision publish|hold|revise, reason, suggestedTags array. Do not loop.",
    JSON.stringify({ title, content, observations: steps }),
    { decision: fallback.decision, reason: fallback.reason, suggestedTags: fallback.suggestedTags },
  );

  return { steps, ...judged };
}
