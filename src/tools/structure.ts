import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { expandShape, paginationShape, pickQuery } from "./common.js";

/**
 * Boards, lists, folders, milestones, labels, members, templates — the
 * "structure" of a workspace.
 *
 * Conventions this API follows, learned the hard way:
 *  - Updates are PUT, never PATCH.
 *  - `visibility` is required on create for every container type.
 *  - Containment on create is a `folder` field; moving afterwards is
 *    `POST /{id}/move` with `parent`.
 *  - Labels and custom fields are board-scoped, not workspace-scoped.
 */

const visibility = z
  .enum(["private", "internal", "shared"])
  .describe(
    "Who can see it: 'private' (you only), 'internal' (team), 'shared' (team + client). Required by the API on create.",
  );

const stateFilter = z
  .enum(["all", "active", "archived"])
  .optional()
  .describe("Which state to return. Defaults to active.");

export function registerStructureTools(reg: ToolRegistry): void {
  /* ---------------------------------------------------------------- */
  /* Boards                                                            */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_boards",
    description: "List boards. Filter by state and title.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      state: stateFilter,
      title: z.string().optional().describe("Title to search for."),
    },
    buildRequest: (input) => ({
      path: "/api/boards",
      query: pickQuery(input, ["page", "per_page", "state", "title"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_board",
    description: "Get a board by ID.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/boards/${encodeURIComponent(id)}` }),
  });

  reg.addCall({
    name: "kitchen_create_board",
    description: "Create a board. title and visibility are both required.",
    method: "POST",
    inputSchema: {
      title: z.string(),
      visibility: visibility.default("private"),
      description: z.string().optional(),
      folder: z
        .string()
        .optional()
        .describe("Folder ID (fo_…) to create the board in."),
      role: z
        .string()
        .optional()
        .describe(
          "Default team role when visibility is 'internal', e.g. board_admin, board_editor, board_viewer.",
        ),
    },
    buildRequest: (input) => ({ path: "/api/boards", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_board",
    description: "Update a board.",
    method: "PUT",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      visibility: visibility.optional(),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/boards/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_move_board",
    description:
      "Move a board into a folder. Pass parent: null to move it to the root.",
    method: "POST",
    inputSchema: {
      id: z.string(),
      parent: z
        .string()
        .nullable()
        .describe("Destination folder ID, or null for the root level."),
    },
    buildRequest: ({ id, parent }) => ({
      path: `/api/boards/${encodeURIComponent(id)}/move`,
      body: { parent },
    }),
  });

  reg.addCall({
    name: "kitchen_archive_board",
    description: "Archive a board. Reversible with kitchen_restore_board.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/boards/${encodeURIComponent(id)}/archive`,
    }),
  });

  reg.addCall({
    name: "kitchen_restore_board",
    description: "Restore an archived board.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/boards/${encodeURIComponent(id)}/restore`,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_board",
    description: "Permanently delete a board. Irreversible.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/boards/${encodeURIComponent(id)}` }),
  });

  /* ---------------------------------------------------------------- */
  /* Lists (board columns)                                             */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_lists",
    description: "List the lists (columns) on a board.",
    readOnly: true,
    method: "GET",
    inputSchema: { board_id: z.string(), ...paginationShape },
    buildRequest: ({ board_id, ...rest }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/lists`,
      query: pickQuery(rest, ["page", "per_page"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_list",
    description: "Get a list (column) by ID.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string(), ...expandShape },
    buildRequest: ({ id, expand }) => ({
      path: `/api/lists/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_list",
    description: "Create a list (column) on a board.",
    method: "POST",
    inputSchema: { board_id: z.string(), title: z.string() },
    buildRequest: ({ board_id, title }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/lists`,
      body: { title },
    }),
  });

  reg.addCall({
    name: "kitchen_update_list",
    description: "Rename a list.",
    method: "PUT",
    inputSchema: { id: z.string(), title: z.string().optional() },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/lists/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_list",
    description: "Permanently delete a list.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/lists/${encodeURIComponent(id)}` }),
  });

  /* ---------------------------------------------------------------- */
  /* Folders                                                           */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_folders",
    description: "List folders. Filter by state and name.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      state: stateFilter,
      name: z.string().optional().describe("Name to search for."),
    },
    buildRequest: (input) => ({
      path: "/api/folders",
      query: pickQuery(input, ["page", "per_page", "state", "name"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_folder",
    description: "Get a folder.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/folders/${encodeURIComponent(id)}` }),
  });

  reg.addCall({
    name: "kitchen_list_folder_children",
    description:
      "List the children (docs, boards, embeds, links, invoices) inside a folder.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string(), ...paginationShape },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/folders/${encodeURIComponent(id)}/children`,
      query: pickQuery(rest, ["page", "per_page"]),
    }),
  });

  reg.addCall({
    name: "kitchen_create_folder",
    description:
      "Create a folder. Note the field is 'name', not 'title' — folders are the one container the API names differently. visibility is required.",
    method: "POST",
    inputSchema: {
      name: z.string().describe("Folder name. Not 'title'."),
      visibility: visibility.default("private"),
      description: z.string().optional(),
      folder: z
        .string()
        .optional()
        .describe("Parent folder ID, to nest this folder inside another."),
      role: z
        .string()
        .optional()
        .describe(
          "Default team role when visibility is 'internal', e.g. folder_admin, folder_viewer.",
        ),
      template: z.string().optional().describe("Template ID to clone from."),
    },
    buildRequest: (input) => ({ path: "/api/folders", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_folder",
    description: "Update a folder.",
    method: "PUT",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      visibility: visibility.optional(),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/folders/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_move_folder",
    description:
      "Move a folder into another folder. Pass parent: null to move it to the root.",
    method: "POST",
    inputSchema: { id: z.string(), parent: z.string().nullable() },
    buildRequest: ({ id, parent }) => ({
      path: `/api/folders/${encodeURIComponent(id)}/move`,
      body: { parent },
    }),
  });

  reg.addCall({
    name: "kitchen_archive_folder",
    description:
      "Archive a folder. Everything inside it is archived too. Reversible.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/folders/${encodeURIComponent(id)}/archive`,
    }),
  });

  reg.addCall({
    name: "kitchen_restore_folder",
    description: "Restore an archived folder.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/folders/${encodeURIComponent(id)}/restore`,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_folder",
    description: "Permanently delete a folder. Irreversible.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/folders/${encodeURIComponent(id)}` }),
  });

  /* ---------------------------------------------------------------- */
  /* Milestones — these live in folders, not boards.                   */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_milestones",
    description: "List milestones. Filter by state and title.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      state: stateFilter,
      title: z.string().optional().describe("Title to search for."),
    },
    buildRequest: (input) => ({
      path: "/api/milestones",
      query: pickQuery(input, ["page", "per_page", "state", "title"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_milestone",
    description: "Get a milestone by ID.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/milestones/${encodeURIComponent(id)}`,
    }),
  });

  reg.addCall({
    name: "kitchen_create_milestone",
    description:
      "Create a milestone. Milestones belong to a folder, not a board — use the 'folder' field. Dates are Y-m-d.",
    method: "POST",
    inputSchema: {
      title: z.string(),
      description: z.string().optional(),
      start_date: z
        .string()
        .optional()
        .describe("Y-m-d. Must be before due_date."),
      due_date: z.string().optional().describe("Y-m-d. Must be after start_date."),
      visibility: visibility.optional(),
      folder: z
        .string()
        .optional()
        .describe("Folder ID (fo_…) the milestone belongs to."),
      role: z.string().optional(),
    },
    buildRequest: (input) => ({ path: "/api/milestones", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_milestone",
    description: "Update a milestone. Dates are Y-m-d.",
    method: "PUT",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      start_date: z.string().optional(),
      due_date: z.string().optional(),
      visibility: visibility.optional(),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/milestones/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_move_milestone",
    description:
      "Move a milestone into a folder. Pass parent: null to move it to the root.",
    method: "POST",
    inputSchema: { id: z.string(), parent: z.string().nullable() },
    buildRequest: ({ id, parent }) => ({
      path: `/api/milestones/${encodeURIComponent(id)}/move`,
      body: { parent },
    }),
  });

  reg.addCall({
    name: "kitchen_archive_milestone",
    description: "Archive a milestone. Reversible.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/milestones/${encodeURIComponent(id)}/archive`,
    }),
  });

  reg.addCall({
    name: "kitchen_restore_milestone",
    description: "Restore an archived milestone.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/milestones/${encodeURIComponent(id)}/restore`,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_milestone",
    description: "Permanently delete a milestone. Irreversible.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/milestones/${encodeURIComponent(id)}`,
    }),
  });

  /* ---------------------------------------------------------------- */
  /* Labels — board-scoped.                                            */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_labels",
    description:
      "List the labels defined on a board. Labels belong to a board, not the workspace, so board_id is required.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      board_id: z.string().describe("Board ID (tskb_…)."),
      ...paginationShape,
      title: z.string().optional().describe("Title to search for."),
    },
    buildRequest: ({ board_id, ...rest }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/labels`,
      query: pickQuery(rest, ["page", "per_page", "title"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_label",
    description: "Get one label on a board.",
    readOnly: true,
    method: "GET",
    inputSchema: { board_id: z.string(), id: z.string() },
    buildRequest: ({ board_id, id }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/labels/${encodeURIComponent(id)}`,
    }),
  });

  // The field is `color`. The docs say `hex_color` is required; the live
  // API rejects that and demands `color`. Verified against
  // teller.kitchen.co on 2026-11-07 — the documentation is wrong here.
  reg.addCall({
    name: "kitchen_create_label",
    description:
      "Create a label on a board. color is required; title is optional. (Kitchen's docs call this field hex_color — they are wrong, the API takes color.)",
    method: "POST",
    inputSchema: {
      board_id: z.string(),
      color: z
        .string()
        .describe("Hex colour, e.g. '#FF00FF'. Required. Not 'hex_color'."),
      title: z.string().optional(),
    },
    buildRequest: ({ board_id, ...body }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/labels`,
      body,
    }),
  });

  reg.addCall({
    name: "kitchen_update_label",
    description: "Update a label on a board.",
    method: "PUT",
    inputSchema: {
      board_id: z.string(),
      id: z.string(),
      title: z.string().optional(),
      color: z.string().optional().describe("Hex colour, e.g. '#FF00FF'."),
    },
    buildRequest: ({ board_id, id, ...rest }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/labels/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_label",
    description: "Permanently delete a label from a board.",
    destructive: true,
    method: "DELETE",
    inputSchema: { board_id: z.string(), id: z.string() },
    buildRequest: ({ board_id, id }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/labels/${encodeURIComponent(id)}`,
    }),
  });

  /* ---------------------------------------------------------------- */
  /* Members                                                           */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_members",
    description: "List the workspace members (team users, not clients).",
    readOnly: true,
    method: "GET",
    inputSchema: { ...paginationShape },
    buildRequest: (input) => ({
      path: "/api/members",
      query: pickQuery(input, ["page", "per_page"]),
    }),
  });

  /* ---------------------------------------------------------------- */
  /* Templates                                                         */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_templates",
    description: "List templates.",
    readOnly: true,
    method: "GET",
    inputSchema: { ...paginationShape, name: z.string().optional() },
    buildRequest: (input) => ({
      path: "/api/templates",
      query: pickQuery(input, ["page", "per_page", "name"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_template",
    description: "Get a template.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/templates/${encodeURIComponent(id)}`,
    }),
  });

  reg.addCall({
    name: "kitchen_create_template",
    description:
      "Turn an existing folder into a template. Both name and folder are required.",
    method: "POST",
    inputSchema: {
      name: z.string(),
      folder: z
        .string()
        .describe("Folder ID (fo_…) the template is built from. Required."),
    },
    buildRequest: (input) => ({ path: "/api/templates", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_template",
    description: "Rename a template.",
    method: "PUT",
    inputSchema: { id: z.string(), name: z.string().optional() },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/templates/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_template",
    description: "Permanently delete a template.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/templates/${encodeURIComponent(id)}`,
    }),
  });
}
