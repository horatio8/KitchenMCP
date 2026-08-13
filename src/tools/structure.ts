import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { paginationShape, pickQuery } from "./common.js";

/**
 * Boards, lists, folders, milestones, labels — the "structure" of a workspace.
 */
export function registerStructureTools(reg: ToolRegistry): void {
  // Boards
  reg.addCall({
    name: "kitchen_list_boards",
    description: "List boards.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      state: z.enum(["active", "archived", "all"]).optional(),
    },
    buildRequest: (input) => ({
      path: "/api/boards",
      query: pickQuery(input, ["page", "per_page", "state"]),
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
    description:
      "Create a board. visibility is required by the API — 'private' (you only), 'internal' (team) or 'shared' (team + client).",
    method: "POST",
    inputSchema: {
      title: z.string(),
      visibility: z
        .enum(["private", "internal", "shared"])
        .default("private")
        .describe("Who can see the board. Required by the Kitchen API."),
      folder_id: z.string().optional(),
    },
    // visibility carries a zod default, so it is always present here.
    buildRequest: (input) => ({ path: "/api/boards", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_board",
    description: "Update a board.",
    method: "PATCH",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      visibility: z.enum(["private", "internal", "shared"]).optional(),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/boards/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_archive_board",
    description: "Archive a board.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/boards/${encodeURIComponent(id)}/archive`,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_board",
    description: "Permanently delete a board.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/boards/${encodeURIComponent(id)}` }),
  });

  // Lists
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
    name: "kitchen_create_list",
    description: "Create a list on a board.",
    method: "POST",
    inputSchema: { board_id: z.string(), title: z.string() },
    buildRequest: ({ board_id, title }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/lists`,
      body: { title },
    }),
  });

  reg.addCall({
    name: "kitchen_update_list",
    description: "Update a list.",
    method: "PATCH",
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

  // Folders
  reg.addCall({
    name: "kitchen_list_folders",
    description: "List folders.",
    readOnly: true,
    method: "GET",
    inputSchema: { ...paginationShape },
    buildRequest: (input) => ({
      path: "/api/folders",
      query: pickQuery(input, ["page", "per_page"]),
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
    description: "List the children (docs, boards, embeds, links) inside a folder.",
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
    description: "Create a folder.",
    method: "POST",
    inputSchema: {
      title: z.string(),
      parent_id: z.string().optional(),
    },
    buildRequest: (input) => ({ path: "/api/folders", body: input }),
  });

  reg.addCall({
    name: "kitchen_delete_folder",
    description: "Permanently delete a folder.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/folders/${encodeURIComponent(id)}` }),
  });

  // Milestones
  reg.addCall({
    name: "kitchen_list_milestones",
    description: "List milestones.",
    readOnly: true,
    method: "GET",
    inputSchema: { ...paginationShape, board_id: z.string().optional() },
    buildRequest: (input) => ({
      path: "/api/milestones",
      query: pickQuery(input, ["page", "per_page", "board_id"]),
    }),
  });

  reg.addCall({
    name: "kitchen_create_milestone",
    description: "Create a milestone.",
    method: "POST",
    inputSchema: {
      title: z.string(),
      board_id: z.string().optional(),
      due_date: z.string().optional(),
    },
    buildRequest: (input) => ({ path: "/api/milestones", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_milestone",
    description: "Update a milestone.",
    method: "PATCH",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      due_date: z.string().nullable().optional(),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/milestones/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_milestone",
    description: "Permanently delete a milestone.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/milestones/${encodeURIComponent(id)}`,
    }),
  });

  // Labels
  reg.addCall({
    name: "kitchen_list_labels",
    description: "List labels.",
    readOnly: true,
    method: "GET",
    inputSchema: { ...paginationShape },
    buildRequest: (input) => ({
      path: "/api/labels",
      query: pickQuery(input, ["page", "per_page"]),
    }),
  });

  reg.addCall({
    name: "kitchen_create_label",
    description: "Create a label.",
    method: "POST",
    inputSchema: {
      title: z.string(),
      color: z.string().optional(),
    },
    buildRequest: (input) => ({ path: "/api/labels", body: input }),
  });

  reg.addCall({
    name: "kitchen_delete_label",
    description: "Delete a label.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/labels/${encodeURIComponent(id)}` }),
  });

  // Members
  reg.addCall({
    name: "kitchen_list_members",
    description: "List the workspace members.",
    readOnly: true,
    method: "GET",
    inputSchema: { ...paginationShape },
    buildRequest: (input) => ({
      path: "/api/members",
      query: pickQuery(input, ["page", "per_page"]),
    }),
  });

  // Templates
  reg.addCall({
    name: "kitchen_list_templates",
    description: "List templates.",
    readOnly: true,
    method: "GET",
    inputSchema: { ...paginationShape },
    buildRequest: (input) => ({
      path: "/api/templates",
      query: pickQuery(input, ["page", "per_page"]),
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
}
