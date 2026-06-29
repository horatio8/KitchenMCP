import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { expandShape, paginationShape, pickQuery } from "./common.js";

export function registerTaskTools(reg: ToolRegistry): void {
  reg.addCall({
    name: "kitchen_list_tasks",
    description:
      "List tasks on a board. board_id is required (use kitchen_list_boards to find it). Optional filters: title, status, members, lists, labels, repeating, starts_at, due_at, custom_fields.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      board_id: z.string().describe("Board ID (tskb_…) to list tasks for."),
      ...paginationShape,
      ...expandShape,
      title: z.string().optional(),
      status: z.string().optional().describe("Status filter, e.g. 'open', 'closed'."),
      repeating: z.boolean().optional(),
      members: z.array(z.string()).optional().describe("User IDs filter."),
      lists: z.array(z.string()).optional().describe("List IDs filter."),
      labels: z.array(z.string()).optional().describe("Label IDs filter."),
      starts_at: z.string().optional().describe("ISO 8601 start date filter."),
      due_at: z.string().optional().describe("ISO 8601 due date filter."),
      custom_fields: z.record(z.unknown()).optional(),
    },
    buildRequest: ({ board_id, ...input }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/tasks`,
      query: pickQuery(input as Record<string, unknown>, [
        "page",
        "per_page",
        "expand",
        "title",
        "status",
        "repeating",
        "members",
        "lists",
        "labels",
        "starts_at",
        "due_at",
        "custom_fields",
      ]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_task",
    description: "Retrieve a task by ID.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      id: z.string(),
      ...expandShape,
    },
    buildRequest: ({ id, expand }) => ({
      path: `/api/tasks/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_task",
    description:
      "Create a task on a board. Requires board_id, list (list ID), and title.",
    method: "POST",
    inputSchema: {
      board_id: z.string().describe("Board ID (tskb_…) the task belongs to."),
      list: z.string().describe("List ID (column) the task belongs to."),
      title: z.string(),
      description: z.string().optional(),
      members: z.array(z.string()).optional().describe("User IDs to assign."),
      due_at: z.string().optional().describe("ISO 8601 due date."),
      starts_at: z.string().optional().describe("ISO 8601 start date."),
      milestone: z.string().optional().describe("Milestone ID."),
      labels: z.array(z.string()).optional().describe("Label IDs."),
    },
    buildRequest: ({ board_id, ...body }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/tasks`,
      body,
    }),
  });

  reg.addCall({
    name: "kitchen_update_task",
    description: "Update a task. Only provided fields will be changed.",
    method: "PUT",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      due_at: z.string().nullable().optional(),
      starts_at: z.string().nullable().optional(),
      milestone: z.string().nullable().optional(),
      list: z.string().optional().describe("List ID to move the task into."),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/tasks/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_task",
    description: "Permanently delete a task. Irreversible.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/tasks/${encodeURIComponent(id)}` }),
  });

  reg.addCall({
    name: "kitchen_toggle_task_completion",
    description: "Toggle a task's completion state (open ⇄ closed).",
    method: "GET",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/tasks/${encodeURIComponent(id)}/completed`,
    }),
  });

  reg.addCall({
    name: "kitchen_move_task",
    description: "Move a task to a different board and/or list.",
    method: "POST",
    inputSchema: {
      id: z.string(),
      board: z.string().describe("Destination board ID."),
      list: z.string().describe("Destination list ID."),
    },
    buildRequest: ({ id, board, list }) => ({
      path: `/api/tasks/${encodeURIComponent(id)}/move`,
      body: { board, list },
    }),
  });

  // Subtasks
  reg.addCall({
    name: "kitchen_list_subtasks",
    description: "List subtasks for a parent task.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string(), ...paginationShape },
    buildRequest: ({ task_id, ...rest }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtasks`,
      query: pickQuery(rest, ["page", "per_page"]),
    }),
  });

  reg.addCall({
    name: "kitchen_create_subtask",
    description: "Create a subtask on a parent task.",
    method: "POST",
    inputSchema: {
      task_id: z.string(),
      title: z.string(),
      assignees: z.array(z.string()).optional(),
      due_date: z.string().optional(),
    },
    buildRequest: ({ task_id, ...rest }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtasks`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_update_subtask",
    description: "Update a subtask.",
    method: "PATCH",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      completed: z.boolean().optional(),
      due_date: z.string().nullable().optional(),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/subtasks/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_subtask",
    description: "Permanently delete a subtask.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/subtasks/${encodeURIComponent(id)}` }),
  });

  // Task comments
  reg.addCall({
    name: "kitchen_list_task_comments",
    description: "List comments on a task.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string(), ...paginationShape },
    buildRequest: ({ task_id, ...rest }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/comments`,
      query: pickQuery(rest, ["page", "per_page"]),
    }),
  });

  reg.addCall({
    name: "kitchen_create_task_comment",
    description: "Add a comment to a task.",
    method: "POST",
    inputSchema: {
      task_id: z.string(),
      content: z.string().min(1),
    },
    buildRequest: ({ task_id, content }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/comments`,
      body: { content },
    }),
  });

  // Task labels / members / notes
  reg.addCall({
    name: "kitchen_add_task_label",
    description: "Add an existing label to a task.",
    method: "POST",
    inputSchema: { task_id: z.string(), label_id: z.string() },
    buildRequest: ({ task_id, label_id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/labels`,
      body: { label_id },
    }),
  });

  reg.addCall({
    name: "kitchen_remove_task_label",
    description: "Remove a label from a task.",
    method: "DELETE",
    inputSchema: { task_id: z.string(), label_id: z.string() },
    buildRequest: ({ task_id, label_id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/labels/${encodeURIComponent(label_id)}`,
    }),
  });

  reg.addCall({
    name: "kitchen_add_task_member",
    description: "Assign a member to a task.",
    method: "POST",
    inputSchema: { task_id: z.string(), user_id: z.string() },
    buildRequest: ({ task_id, user_id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/members`,
      body: { user_id },
    }),
  });

  reg.addCall({
    name: "kitchen_remove_task_member",
    description: "Unassign a member from a task.",
    method: "DELETE",
    inputSchema: { task_id: z.string(), user_id: z.string() },
    buildRequest: ({ task_id, user_id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/members/${encodeURIComponent(user_id)}`,
    }),
  });
}
