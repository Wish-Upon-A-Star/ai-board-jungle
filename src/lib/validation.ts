import { z } from "zod";

export const emailSchema = z.string().email().max(120);
export const passwordSchema = z.string().min(8).max(120);

export const registerSchema = z.object({
  email: emailSchema,
  name: z.string().min(2).max(40),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(120),
});

export const postSchema = z.object({
  title: z.string().min(3).max(120),
  content: z.string().min(10).max(8000),
  tags: z.array(z.string().min(1).max(30)).max(8).default([]),
});

export const commentSchema = z.object({
  content: z.string().min(1).max(1000),
});

export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((tag) => String(tag).trim().replace(/^#/, ""))
        .filter(Boolean)
        .slice(0, 8),
    ),
  );
}
