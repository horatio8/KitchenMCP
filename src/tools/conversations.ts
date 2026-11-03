import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { expandShape, paginationShape, pickQuery } from "./common.js";

const visibility = z
  .enum(["private", "internal", "shared"])
  .describe(
    "Who can see it: 'private', 'internal' (team), 'shared' (team + client).",
  );

export function registerConversationTools(reg: ToolRegistry): void {
  reg.addCall({
    name: "kitchen_list_conversations",
    description: "List conversations.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      ...expandShape,
      state: z.enum(["all", "active", "archived"]).optional(),
      title: z.string().optional(),
    },
    buildRequest: (input) => ({
      path: "/api/conversations",
      query: pickQuery(input, ["page", "per_page", "expand", "state", "title"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_conversation",
    description: "Retrieve a conversation by ID.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string(), ...expandShape },
    buildRequest: ({ id, expand }) => ({
      path: `/api/conversations/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_conversation",
    description:
      "Create a conversation. title and visibility are required. Add people by creating memberships, or seed the thread by passing a first message.",
    method: "POST",
    inputSchema: {
      title: z.string(),
      visibility: visibility.default("shared"),
      description: z.string().optional(),
      folder: z.string().optional().describe("Folder ID (fo_…) to create it in."),
      role: z
        .string()
        .optional()
        .describe(
          "Default team role when visibility is 'internal', e.g. conversation_admin, conversation_viewer.",
        ),
      message: z
        .any()
        .optional()
        .describe(
          "Optional first message, e.g. { content: '…', format: 'text' }. Including a client here forces visibility to shared.",
        ),
    },
    buildRequest: (input) => ({ path: "/api/conversations", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_conversation",
    description: "Update a conversation.",
    method: "PUT",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      visibility: visibility.optional(),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/conversations/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_move_conversation",
    description:
      "Move a conversation into a folder. Pass parent: null to move it to the root.",
    method: "POST",
    inputSchema: { id: z.string(), parent: z.string().nullable() },
    buildRequest: ({ id, parent }) => ({
      path: `/api/conversations/${encodeURIComponent(id)}/move`,
      body: { parent },
    }),
  });

  reg.addCall({
    name: "kitchen_archive_conversation",
    description: "Archive a conversation.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/conversations/${encodeURIComponent(id)}/archive`,
    }),
  });

  reg.addCall({
    name: "kitchen_restore_conversation",
    description: "Restore an archived conversation.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/conversations/${encodeURIComponent(id)}/restore`,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_conversation",
    description: "Permanently delete a conversation.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/conversations/${encodeURIComponent(id)}`,
    }),
  });

  /* ---------------------------------------------------------------- */
  /* Messages — nested under the conversation, always.                 */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_messages",
    description: "List messages in a conversation.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      conversation_id: z.string(),
      ...paginationShape,
      ...expandShape,
      content: z.string().optional().describe("Content to search for."),
    },
    buildRequest: ({ conversation_id, ...rest }) => ({
      path: `/api/conversations/${encodeURIComponent(conversation_id)}/messages`,
      query: pickQuery(rest, ["page", "per_page", "expand", "content"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_message",
    description: "Get one message in a conversation.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      conversation_id: z.string(),
      id: z.string(),
      ...expandShape,
    },
    buildRequest: ({ conversation_id, id, expand }) => ({
      path: `/api/conversations/${encodeURIComponent(conversation_id)}/messages/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_message",
    description:
      "Send a message in a conversation. format is required by the API. Pass send_at to schedule it instead of sending now.",
    method: "POST",
    inputSchema: {
      conversation_id: z.string(),
      content: z.string().min(1),
      format: z
        .enum(["text", "html"])
        .default("text")
        .describe("Required by the Kitchen API."),
      attachments: z
        .array(z.string())
        .optional()
        .describe("File IDs (fi_…) to attach. Each file can be used only once."),
      send_at: z
        .string()
        .optional()
        .describe("ISO 8601. Omit to send immediately."),
    },
    buildRequest: ({ conversation_id, content, format, attachments, send_at }) => ({
      path: `/api/conversations/${encodeURIComponent(conversation_id)}/messages`,
      body: {
        content,
        format: format ?? "text",
        ...(attachments?.length ? { attachments } : {}),
        ...(send_at ? { send_at } : {}),
      },
    }),
  });

  reg.addCall({
    name: "kitchen_update_message",
    description: "Edit a message.",
    method: "PUT",
    inputSchema: {
      conversation_id: z.string(),
      id: z.string(),
      content: z.string().optional(),
      send_at: z.string().optional(),
    },
    buildRequest: ({ conversation_id, id, ...rest }) => ({
      path: `/api/conversations/${encodeURIComponent(conversation_id)}/messages/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_message",
    description: "Permanently delete a message.",
    destructive: true,
    method: "DELETE",
    inputSchema: { conversation_id: z.string(), id: z.string() },
    buildRequest: ({ conversation_id, id }) => ({
      path: `/api/conversations/${encodeURIComponent(conversation_id)}/messages/${encodeURIComponent(id)}`,
    }),
  });

  /* ---------------------------------------------------------------- */
  /* Conversation notes — internal, not visible in the thread.         */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_conversation_notes",
    description: "List the internal notes on a conversation.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      conversation_id: z.string(),
      ...paginationShape,
      ...expandShape,
    },
    buildRequest: ({ conversation_id, ...rest }) => ({
      path: `/api/conversations/${encodeURIComponent(conversation_id)}/notes`,
      query: pickQuery(rest, ["page", "per_page", "expand"]),
    }),
  });

  reg.addCall({
    name: "kitchen_create_conversation_note",
    description: "Add an internal note to a conversation.",
    method: "POST",
    inputSchema: {
      conversation_id: z.string(),
      content: z.string().min(1),
      format: z.enum(["text", "html"]).default("text"),
    },
    buildRequest: ({ conversation_id, content, format }) => ({
      path: `/api/conversations/${encodeURIComponent(conversation_id)}/notes`,
      body: { content, format: format ?? "text" },
    }),
  });

  reg.addCall({
    name: "kitchen_update_conversation_note",
    description: "Edit an internal note on a conversation.",
    method: "PUT",
    inputSchema: {
      conversation_id: z.string(),
      id: z.string(),
      content: z.string().min(1),
    },
    buildRequest: ({ conversation_id, id, content }) => ({
      path: `/api/conversations/${encodeURIComponent(conversation_id)}/notes/${encodeURIComponent(id)}`,
      body: { content },
    }),
  });

  reg.addCall({
    name: "kitchen_delete_conversation_note",
    description: "Permanently delete an internal note on a conversation.",
    destructive: true,
    method: "DELETE",
    inputSchema: { conversation_id: z.string(), id: z.string() },
    buildRequest: ({ conversation_id, id }) => ({
      path: `/api/conversations/${encodeURIComponent(conversation_id)}/notes/${encodeURIComponent(id)}`,
    }),
  });
}
