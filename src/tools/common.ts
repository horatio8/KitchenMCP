import { z } from "zod";

export const paginationShape = {
  page: z.number().int().positive().optional().describe("Page number (1-indexed)."),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Items per page (default 20, max 100)."),
};

export const expandShape = {
  expand: z
    .array(z.string())
    .optional()
    .describe(
      "Expand related IDs into full objects (e.g. ['client', 'assignee']). Nested with dots: 'task.assignee'.",
    ),
};

export const idShape = {
  id: z.string().min(1).describe("Resource ID."),
};

export function pickQuery<T extends Record<string, unknown>>(
  input: T,
  keys: readonly (keyof T)[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) out[key as string] = input[key];
  }
  return out;
}
