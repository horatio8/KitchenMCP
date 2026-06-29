import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { expandShape, paginationShape, pickQuery } from "./common.js";

export function registerConversationTools(reg: ToolRegistry): void {
  reg.addCall({
    name: "kitchen_list_conversations",
    description: "List conversations.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      ...expandShape,
      state: z.enum(["active", "archived", "all"]).optional(),
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
    description: "Create a conversation.",
    method: "POST",
    inputSchema: {
      title: z.string(),
      folder_id: z.string().optional(),
      member_ids: z.array(z.string()).optional(),
    },
    buildRequest: (input) => ({ path: "/api/conversations", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_conversation",
    description: "Update a conversation.",
    method: "PATCH",
    inputSchema: { id: z.string(), title: z.string().optional() },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/conversations/${encodeURIComponent(id)}`,
      body: rest,
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

  // Messages
  reg.addCall({
    name: "kitchen_list_messages",
    description: "List messages in a conversation.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      conversation_id: z.string(),
      ...paginationShape,
      ...expandShape,
    },
    buildRequest: ({ conversation_id, ...rest }) => ({
      path: `/api/conversations/${encodeURIComponent(conversation_id)}/messages`,
      query: pickQuery(rest, ["page", "per_page", "expand"]),
    }),
  });

  reg.addCall({
    name: "kitchen_create_message",
    description: "Send a message in a conversation.",
    method: "POST",
    inputSchema: {
      conversation_id: z.string(),
      content: z.string().min(1),
      attachment_ids: z.array(z.string()).optional(),
    },
    buildRequest: ({ conversation_id, ...rest }) => ({
      path: `/api/conversations/${encodeURIComponent(conversation_id)}/messages`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_update_message",
    description: "Edit a message.",
    method: "PATCH",
    inputSchema: { id: z.string(), content: z.string() },
    buildRequest: ({ id, content }) => ({
      path: `/api/messages/${encodeURIComponent(id)}`,
      body: { content },
    }),
  });

  reg.addCall({
    name: "kitchen_delete_message",
    description: "Delete a message.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/messages/${encodeURIComponent(id)}` }),
  });
}
