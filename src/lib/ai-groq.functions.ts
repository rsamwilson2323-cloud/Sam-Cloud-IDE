import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    }),
  ),
  model: z.string().optional(),
});

export const chatWithGroq = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY not configured");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: data.model || "llama-3.3-70b-versatile",
        messages: data.messages,
        temperature: 0.5,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Groq error ${res.status}: ${t.slice(0, 300)}`);
    }
    const json = (await res.json()) as any;
    const text = json?.choices?.[0]?.message?.content ?? "";
    return { text };
  });
