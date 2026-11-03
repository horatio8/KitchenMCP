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
    description:
      "Create a doc. visibility is required. Note the doc's text is not settable here — the API takes a 'description', not page content.",
    method: "POST",
    inputSchema: {
      title: z.string(),
      visibility: z
        .enum(["private", "internal", "shared"])
        .default("private")
        .describe("Required by the API."),
      description: z.string().optional(),
      folder: z.string().optional().describe("Folder ID (fo_…) to create it in."),
      role: z
        .string()
        .optional()
        .describe(
          "Default team role when visibility is 'internal', e.g. document_admin, document_editor, document_viewer.",
        ),
    },
    buildRequest: (input) => ({ path: "/api/docs", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_doc",
    description: "Update a doc.",
    method: "PUT",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      visibility: z.enum(["private", "internal", "shared"]).optional(),
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
    description:
      "Move a doc into a folder. Pass parent: null to move it to the root.",
    method: "POST",
    inputSchema: { id: z.string(), parent: z.string().nullable() },
    buildRequest: ({ id, parent }) => ({
      path: `/api/docs/${encodeURIComponent(id)}/move`,
      body: { parent },
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

  const docRole = z
    .enum([
      "document_admin",
      "document_manager",
      "document_editor",
      "document_viewer",
    ])
    .describe("Required by the API.");

  reg.addCall({
    name: "kitchen_create_doc_membership",
    description:
      "Give a user or a company access to a doc. role is required, and you pass either 'user' or 'company', not both. Omit 'notification' and nobody is emailed.",
    method: "POST",
    inputSchema: {
      doc_id: z.string(),
      role: docRole,
      user: z.string().optional().describe("User ID (u_…). Either this or company."),
      company: z
        .string()
        .optional()
        .describe("Company ID (co_…). Either this or user."),
      notification: z
        .string()
        .optional()
        .describe("Message to send them. Omit to add them silently."),
    },
    buildRequest: ({ doc_id, ...rest }) => ({
      path: `/api/docs/${encodeURIComponent(doc_id)}/memberships`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_update_doc_membership",
    description: "Change a doc membership's role.",
    method: "PUT",
    inputSchema: {
      doc_id: z.string(),
      membership_id: z.string().describe("Membership ID (nms_…)."),
      role: docRole,
    },
    buildRequest: ({ doc_id, membership_id, role }) => ({
      path: `/api/docs/${encodeURIComponent(doc_id)}/memberships/${encodeURIComponent(membership_id)}`,
      body: { role },
    }),
  });

  reg.addCall({
    name: "kitchen_delete_doc_membership",
    description: "Remove a user or company from a doc.",
    method: "DELETE",
    inputSchema: {
      doc_id: z.string(),
      membership_id: z.string().describe("Membership ID (nms_…)."),
    },
    buildRequest: ({ doc_id, membership_id }) => ({
      path: `/api/docs/${encodeURIComponent(doc_id)}/memberships/${encodeURIComponent(membership_id)}`,
    }),
  });
}
