import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { expandShape, paginationShape, pickQuery } from "./common.js";

export function registerTaskTools(reg: ToolRegistry): void {
  reg.addCall({
    name: "kitchen_list_tasks",
    description: "List tasks. Optional filters: list_id, board_id, assignee, milestone, label, state, title.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      ...expandShape,
      list_id: z.string().optional(),
      board_id: z.string().optional(),
      milestone: z.string().optional(),
      assignee: z.string().optional(),
      label: z.string().optional(),
      state: z.enum(["active", "archived", "all"]).optional(),
      title: z.string().optional(),
    },
    buildRequest: (input) => ({
      path: "/api/tasks",
      query: pickQuery(input, [
        "page",
        "per_page",
        "expand",
        "list_id",
        "board_id",
        "milestone",
        "assignee",
        "label",
        "state",
        "title",
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
    description: "Create a task on a list. Requires list_id and title.",
    method: "POST",
    inputSchema: {
      list_id: z.string().describe("ID of the list to attach this task to."),
      title: z.string(),
      description: z.string().optional(),
      assignees: z.array(z.string()).optional().describe("User IDs to assign."),
      due_date: z.string().optional().describe("ISO 8601 due date."),
      start_date: z.string().optional().describe("ISO 8601 start date."),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      milestone_id: z.string().optional(),
      labels: z.array(z.string()).optional(),
    },
    buildRequest: (input) => ({
      path: "/api/tasks",
      body: input,
    }),
  });

  reg.addCall({
    name: "kitchen_update_task",
    description: "Update a task. Only provided fields will be changed.",
    method: "PATCH",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      due_date: z.string().nullable().optional(),
      start_date: z.string().nullable().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
      milestone_id: z.string().nullable().optional(),
      list_id: z.string().optional(),
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
    description: "Toggle a task's completion state.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/tasks/${encodeURIComponent(id)}/toggle-completion`,
    }),
  });

  reg.addCall({
    name: "kitchen_move_tasks",
    description: "Move one or more tasks to a different list/position.",
    method: "POST",
    inputSchema: {
      task_ids: z.array(z.string()).min(1),
      list_id: z.string(),
      position: z.number().int().optional(),
    },
    buildRequest: (input) => ({
      path: "/api/tasks/move",
      body: input,
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
