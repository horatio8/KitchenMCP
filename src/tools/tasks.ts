import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { expandShape, paginationShape, pickQuery } from "./common.js";

/**
 * Tasks and everything hanging off them.
 *
 * Almost all of this is nested under the task: subtasks, subtask lists,
 * comments, labels, members and custom field values are all addressed
 * as `/api/tasks/{task}/…/{id}`, never as a top-level resource. Writing
 * to a flat `/api/subtasks/{id}` silently 404s.
 *
 * Note this is the Tasks API. The Cards API (`/api/cards`, with its own
 * card-labels, card-members and card-custom-fields) is the predecessor
 * and is documented as deprecated and scheduled for removal, so it is
 * deliberately not exposed here.
 */
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
      "Create a task on a board. board_id, list and title are required. A task takes a single 'assignee', not a members array — add further people with kitchen_add_task_member, and labels with kitchen_add_task_label.",
    method: "POST",
    inputSchema: {
      board_id: z.string().describe("Board ID (tskb_…) the task belongs to."),
      list: z.string().describe("List ID (column) the task belongs to. Required."),
      title: z.string(),
      description: z
        .string()
        .optional()
        .describe("Accepts an HTML string to format the content."),
      assignee: z.string().optional().describe("User ID to assign (one only)."),
      due_at: z.string().optional().describe("ISO 8601 due date."),
      start_at: z
        .string()
        .nullable()
        .optional()
        .describe("ISO 8601 start date. Note: start_at, not starts_at."),
      due_reminder: z
        .string()
        .optional()
        .describe("ISO 8601 time at which a due reminder is sent."),
      milestone: z.string().nullable().optional().describe("Milestone ID (mst_…)."),
      parent: z.string().optional().describe("Parent task ID (tsk_…)."),
      remaining_minutes_estimate: z.number().int().optional(),
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
      assignee: z.string().nullable().optional(),
      due_at: z.string().nullable().optional(),
      start_at: z
        .string()
        .nullable()
        .optional()
        .describe("ISO 8601. Note: start_at, not starts_at."),
      due_reminder: z.string().nullable().optional(),
      milestone: z.string().nullable().optional(),
      remaining_minutes_estimate: z.number().int().optional(),
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

  /* ---------------------------------------------------------------- */
  /* Subtask lists (checklists)                                        */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_subtask_lists",
    description:
      "List a task's subtask lists (checklists). A subtask must belong to one of these, so call this — or create one — before kitchen_create_subtask.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string(), ...paginationShape, ...expandShape },
    buildRequest: ({ task_id, ...rest }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtask-lists`,
      query: pickQuery(rest, ["page", "per_page", "expand"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_subtask_list",
    description: "Get one subtask list on a task.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string(), id: z.string(), ...expandShape },
    buildRequest: ({ task_id, id, expand }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtask-lists/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_subtask_list",
    description:
      "Create a subtask list (checklist) on a task. The field is 'name', not 'title'.",
    method: "POST",
    inputSchema: { task_id: z.string(), name: z.string() },
    buildRequest: ({ task_id, name }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtask-lists`,
      body: { name },
    }),
  });

  reg.addCall({
    name: "kitchen_update_subtask_list",
    description: "Rename a subtask list.",
    method: "PUT",
    inputSchema: { task_id: z.string(), id: z.string(), name: z.string().optional() },
    buildRequest: ({ task_id, id, ...rest }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtask-lists/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_subtask_list",
    description: "Delete a subtask list from a task.",
    destructive: true,
    method: "DELETE",
    inputSchema: { task_id: z.string(), id: z.string() },
    buildRequest: ({ task_id, id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtask-lists/${encodeURIComponent(id)}`,
    }),
  });

  /* ---------------------------------------------------------------- */
  /* Subtasks — nested under the task, and each needs a subtask list.  */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_subtasks",
    description: "List subtasks for a parent task.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string(), ...paginationShape, ...expandShape },
    buildRequest: ({ task_id, ...rest }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtasks`,
      query: pickQuery(rest, ["page", "per_page", "expand"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_subtask",
    description: "Get one subtask.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string(), id: z.string(), ...expandShape },
    buildRequest: ({ task_id, id, expand }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtasks/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_subtask",
    description:
      "Create a subtask on a parent task. subtask_list is required — get one from kitchen_list_subtask_lists or create it with kitchen_create_subtask_list first.",
    method: "POST",
    inputSchema: {
      task_id: z.string(),
      title: z.string(),
      subtask_list: z
        .string()
        .describe("Subtask list ID (tskl_…) to create it in. Required."),
      due_at: z.string().nullable().optional().describe("Y-m-d, e.g. 2026-03-25."),
    },
    buildRequest: ({ task_id, ...rest }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtasks`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_update_subtask",
    description: "Update a subtask.",
    method: "PUT",
    inputSchema: {
      task_id: z.string().describe("Parent task ID (tsk_…)."),
      id: z.string().describe("Subtask ID."),
      title: z.string().optional(),
      due_at: z.string().nullable().optional().describe("Y-m-d, e.g. 2026-03-25."),
    },
    buildRequest: ({ task_id, id, ...rest }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtasks/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_subtask",
    description: "Permanently delete a subtask.",
    destructive: true,
    method: "DELETE",
    inputSchema: { task_id: z.string(), id: z.string() },
    buildRequest: ({ task_id, id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/subtasks/${encodeURIComponent(id)}`,
    }),
  });

  /* ---------------------------------------------------------------- */
  /* Task comments                                                     */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_task_comments",
    description: "List comments on a task.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string(), ...paginationShape, ...expandShape },
    buildRequest: ({ task_id, ...rest }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/comments`,
      query: pickQuery(rest, ["page", "per_page", "expand"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_task_comment",
    description: "Get one comment on a task.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string(), id: z.string(), ...expandShape },
    buildRequest: ({ task_id, id, expand }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/comments/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_task_comment",
    description:
      "Add a comment to a task. Optionally attach files by ID (fi_...) — use this to pin the approved creative to the approval record.",
    method: "POST",
    inputSchema: {
      task_id: z.string(),
      content: z.string().min(1),
      format: z
        .enum(["text", "html"])
        .default("text")
        .describe("Required by the Kitchen API."),
      attachments: z
        .array(z.string())
        .optional()
        .describe("File IDs (fi_...) to attach to the comment."),
    },
    buildRequest: ({ task_id, content, format, attachments }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/comments`,
      body: {
        content,
        format: format ?? "text",
        ...(attachments?.length ? { attachments } : {}),
      },
    }),
  });

  reg.addCall({
    name: "kitchen_update_task_comment",
    description:
      "Edit a comment on a task. Note that the workflow audit trail is built from comments: correcting a typo is fine, but rewriting a recorded gate pass or client approval destroys the evidence that it said something else. Post a correcting comment instead.",
    method: "PUT",
    inputSchema: {
      task_id: z.string(),
      id: z.string().describe("Comment ID (msg_…)."),
      content: z.string().min(1),
    },
    buildRequest: ({ task_id, id, content }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/comments/${encodeURIComponent(id)}`,
      body: { content },
    }),
  });

  reg.addCall({
    name: "kitchen_delete_task_comment",
    description:
      "Permanently delete a comment on a task. Irreversible, and it removes part of the audit trail — prefer a correcting comment.",
    destructive: true,
    method: "DELETE",
    inputSchema: { task_id: z.string(), id: z.string() },
    buildRequest: ({ task_id, id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/comments/${encodeURIComponent(id)}`,
    }),
  });

  /* ---------------------------------------------------------------- */
  /* Task notes — internal, unlike comments.                           */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_task_notes",
    description:
      "List the internal notes on a task. Notes are separate from comments and are not part of the client-visible thread.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      task_id: z.string(),
      ...paginationShape,
      ...expandShape,
      content: z.string().optional().describe("Content to search for."),
    },
    buildRequest: ({ task_id, ...rest }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/notes`,
      query: pickQuery(rest, ["page", "per_page", "expand", "content"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_task_note",
    description: "Get one internal note on a task.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string(), id: z.string(), ...expandShape },
    buildRequest: ({ task_id, id, expand }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/notes/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_task_note",
    description:
      "Add an internal note to a task. format is required. Use this for working notes that should not appear to the client; use kitchen_create_task_comment for anything that forms part of the record.",
    method: "POST",
    inputSchema: {
      task_id: z.string(),
      content: z.string().min(1),
      format: z
        .enum(["text", "html"])
        .default("text")
        .describe("Required by the Kitchen API."),
    },
    buildRequest: ({ task_id, content, format }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/notes`,
      body: { content, format: format ?? "text" },
    }),
  });

  reg.addCall({
    name: "kitchen_update_task_note",
    description: "Edit an internal note on a task.",
    method: "PUT",
    inputSchema: {
      task_id: z.string(),
      id: z.string(),
      content: z.string().min(1),
    },
    buildRequest: ({ task_id, id, content }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/notes/${encodeURIComponent(id)}`,
      body: { content },
    }),
  });

  reg.addCall({
    name: "kitchen_delete_task_note",
    description: "Permanently delete an internal note on a task.",
    destructive: true,
    method: "DELETE",
    inputSchema: { task_id: z.string(), id: z.string() },
    buildRequest: ({ task_id, id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/notes/${encodeURIComponent(id)}`,
    }),
  });

  /* ---------------------------------------------------------------- */
  /* Task labels and members                                           */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_task_labels",
    description: "List the labels applied to a task.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string() },
    buildRequest: ({ task_id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/labels`,
    }),
  });

  reg.addCall({
    name: "kitchen_add_task_label",
    description:
      "Add an existing label to a task. Labels are board-scoped — use kitchen_list_labels with the task's board to find the id.",
    method: "POST",
    inputSchema: {
      task_id: z.string(),
      label: z.string().describe("Label ID (lbl_…)."),
    },
    buildRequest: ({ task_id, label }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/labels`,
      body: { label },
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
    name: "kitchen_list_task_members",
    description: "List the members assigned to a task.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string() },
    buildRequest: ({ task_id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/members`,
    }),
  });

  reg.addCall({
    name: "kitchen_add_task_member",
    description: "Assign a member to a task.",
    method: "POST",
    inputSchema: {
      task_id: z.string(),
      user: z.string().describe("User ID (u_…)."),
    },
    buildRequest: ({ task_id, user }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/members`,
      body: { user },
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
