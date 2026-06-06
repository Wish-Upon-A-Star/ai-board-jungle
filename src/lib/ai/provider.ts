import OpenAI from "openai";

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export async function chatJSON<T>(system: string, user: string, fallback: T): Promise<T> {
  if (!client) return fallback;
  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const text = response.choices[0]?.message.content || "";
    return JSON.parse(text) as T;
  } catch (error) {
    console.warn("LLM fallback used", error);
    return fallback;
  }
}

export async function embedText(text: string): Promise<number[] | null> {
  if (!client) return null;
  try {
    const response = await client.embeddings.create({
      model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
      input: text.slice(0, 8000),
    });
    return response.data[0]?.embedding ?? null;
  } catch (error) {
    console.warn("Embedding fallback used", error);
    return null;
  }
}
