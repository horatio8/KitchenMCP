import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { expandShape, paginationShape, pickQuery } from "./common.js";

export function registerDocTools(reg: ToolRegistry): void {
  reg.addCall({
    name: "kitchen_list_docs",
    description: "List docs in the workspace. Filter by state (active/archived/all) and title.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      ...expandShape,
      state: z.enum(["active", "archived", "all"]).optional(),
      title: z.string().optional(),
    },
    buildRequest: (input) => ({
      path: "/api/docs",
      query: pickQuery(input, ["page", "per_page", "expand", "state", "title"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_doc",
    description: "Retrieve a doc by ID.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string(), ...expandShape },
    buildRequest: ({ id, expand }) => ({
      path: `/api/docs/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_doc",
    description: "Create a new doc.",
    method: "POST",
    inputSchema: {
      title: z.string(),
      content: z.string().optional(),
      folder_id: z.string().optional(),
    },
    buildRequest: (input) => ({ path: "/api/docs", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_doc",
    description: "Update a doc.",
    method: "PATCH",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/docs/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_archive_doc",
    description: "Archive a doc.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/docs/${encodeURIComponent(id)}/archive`,
    }),
  });

  reg.addCall({
    name: "kitchen_restore_doc",
    description: "Restore an archived doc.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/docs/${encodeURIComponent(id)}/restore`,
    }),
  });

  reg.addCall({
    name: "kitchen_move_doc",
    description: "Move a doc into a folder.",
    method: "POST",
    inputSchema: { id: z.string(), folder_id: z.string().nullable() },
    buildRequest: ({ id, folder_id }) => ({
      path: `/api/docs/${encodeURIComponent(id)}/move`,
      body: { folder_id },
    }),
  });

  reg.addCall({
    name: "kitchen_delete_doc",
    description: "Permanently delete a doc.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/docs/${encodeURIComponent(id)}` }),
  });

  // Doc memberships
  reg.addCall({
    name: "kitchen_list_doc_memberships",
    description: "List memberships for a doc.",
    readOnly: true,
    method: "GET",
    inputSchema: { doc_id: z.string() },
    buildRequest: ({ doc_id }) => ({
      path: `/api/docs/${encodeURIComponent(doc_id)}/memberships`,
    }),
  });

  reg.addCall({
    name: "kitchen_create_doc_membership",
    description: "Add a user to a doc.",
    method: "POST",
    inputSchema: {
      doc_id: z.string(),
      user_id: z.string(),
      role: z.string().optional(),
    },
    buildRequest: ({ doc_id, ...rest }) => ({
      path: `/api/docs/${encodeURIComponent(doc_id)}/memberships`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_doc_membership",
    description: "Remove a user from a doc.",
    method: "DELETE",
    inputSchema: { doc_id: z.string(), membership_id: z.string() },
    buildRequest: ({ doc_id, membership_id }) => ({
      path: `/api/docs/${encodeURIComponent(doc_id)}/memberships/${encodeURIComponent(membership_id)}`,
    }),
  });
}
