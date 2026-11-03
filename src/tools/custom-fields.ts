import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { paginationShape, pickQuery } from "./common.js";

/**
 * Custom fields.
 *
 * Definitions are board-scoped (`/api/boards/{board}/custom-fields`);
 * values are set per task (`/api/tasks/{task}/custom-fields`). A value
 * is addressed by the custom field's own id, not by a separate join id.
 *
 * This matters beyond CRUD completeness: the deliverable workflow
 * encodes its metadata in a fenced block inside the task description,
 * on the premise that Kitchen had nowhere structured to put it. It
 * does. Typed, board-scoped fields with `visible_to_clients` are a
 * better home for state, jurisdiction, version and approver than text
 * parsed out of a description — queryable in the API, filterable in the
 * UI, and not silently destroyed by anyone who edits the description.
 * The fenced block stays for now so existing cards keep working; these
 * tools are what a migration would be built on.
 */

/** The field types Kitchen supports. */
const FIELD_TYPES = [
  "text",
  "number",
  "list",
  "multi_list",
  "date",
  "boolean",
  "url",
  "email",
  "phone",
] as const;

const optionValue = z.object({
  value: z.string().describe("The option's label."),
  color: z.string().describe("Hex colour, e.g. '#FF00FF'. Required per option."),
  id: z
    .string()
    .optional()
    .describe(
      "Option id. Omit when creating; required (and must be unique) when updating, or existing values lose their option.",
    ),
});

const optionsObject = z
  .object({
    values: z
      .array(optionValue)
      .optional()
      .describe("Required when type is list or multi_list."),
    number_format: z
      .enum(["plain", "separated", "percentage", "currency"])
      .optional()
      .describe("Required when type is number."),
    currency: z
      .string()
      .optional()
      .describe("Required when number_format is currency."),
  })
  .optional();

export function registerCustomFieldTools(reg: ToolRegistry): void {
  /* ---------------------------------------------------------------- */
  /* Definitions, per board                                            */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_custom_fields",
    description:
      "List the custom field definitions on a board. Call this before setting a value on a task — you need the field's id, and for list/multi_list fields you need the option ids too.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      board_id: z.string().describe("Board ID (tskb_…)."),
      ...paginationShape,
      name: z.string().optional().describe("Name to search for."),
    },
    buildRequest: ({ board_id, ...rest }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/custom-fields`,
      query: pickQuery(rest, ["page", "per_page", "name"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_custom_field",
    description: "Get one custom field definition on a board.",
    readOnly: true,
    method: "GET",
    inputSchema: { board_id: z.string(), id: z.string() },
    buildRequest: ({ board_id, id }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/custom-fields/${encodeURIComponent(id)}`,
    }),
  });

  reg.addCall({
    name: "kitchen_create_custom_field",
    description:
      "Create a custom field on a board. name and type are required. For list/multi_list pass options.values; for number pass options.number_format. Set visible_to_clients: false for anything internal — compliance state, reviewer names, evidence status.",
    method: "POST",
    inputSchema: {
      board_id: z.string(),
      name: z.string(),
      type: z.enum(FIELD_TYPES),
      options: optionsObject,
      color: z.string().optional().describe("Hex colour, e.g. '#FF00FF'."),
      show_icon: z.boolean().optional(),
      visible_to_clients: z
        .boolean()
        .optional()
        .describe("Whether clients can see this field. Defaults to false."),
    },
    buildRequest: ({ board_id, ...body }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/custom-fields`,
      body,
    }),
  });

  reg.addCall({
    name: "kitchen_update_custom_field",
    description:
      "Update a custom field definition. name is required even when you are only changing something else. When editing options, include each existing option's id or the values already set on tasks lose their option.",
    method: "PUT",
    inputSchema: {
      board_id: z.string(),
      id: z.string(),
      name: z.string().describe("Required by the API on update, not just create."),
      options: optionsObject,
      color: z.string().optional(),
      show_icon: z.boolean().optional(),
      visible_to_clients: z.boolean().optional(),
    },
    buildRequest: ({ board_id, id, ...rest }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/custom-fields/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_custom_field",
    description:
      "Permanently delete a custom field from a board. This removes the values held on every task on that board. Irreversible.",
    destructive: true,
    method: "DELETE",
    inputSchema: { board_id: z.string(), id: z.string() },
    buildRequest: ({ board_id, id }) => ({
      path: `/api/boards/${encodeURIComponent(board_id)}/custom-fields/${encodeURIComponent(id)}`,
    }),
  });

  /* ---------------------------------------------------------------- */
  /* Values, per task                                                  */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_task_custom_fields",
    description:
      "List the custom field values set on a task. Returns [{id, value}] where id is the custom field's id — pair with kitchen_list_custom_fields to get names and option labels.",
    readOnly: true,
    method: "GET",
    inputSchema: { task_id: z.string() },
    buildRequest: ({ task_id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/custom-fields`,
    }),
  });

  reg.addCall({
    name: "kitchen_set_task_custom_field",
    description:
      "Set a custom field value on a task for the first time. For multi_list, value is an array of option ids; for list, the option id; otherwise the plain value. Use kitchen_update_task_custom_field to change a value that is already set.",
    method: "POST",
    inputSchema: {
      task_id: z.string(),
      custom_field: z.string().describe("Custom field ID (cf_…). Required."),
      value: z
        .any()
        .describe(
          "The value: string, number, boolean, date, or an array of option ids for multi_list.",
        ),
    },
    buildRequest: ({ task_id, custom_field, value }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/custom-fields`,
      body: { custom_field, value },
    }),
  });

  reg.addCall({
    name: "kitchen_update_task_custom_field",
    description:
      "Change a custom field value already set on a task. The id in the path is the custom field's id, not a separate value id.",
    method: "PUT",
    inputSchema: {
      task_id: z.string(),
      custom_field_id: z.string().describe("Custom field ID (cf_…)."),
      value: z
        .any()
        .describe(
          "The new value: string, number, boolean, date, or an array of option ids for multi_list.",
        ),
    },
    buildRequest: ({ task_id, custom_field_id, value }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/custom-fields/${encodeURIComponent(custom_field_id)}`,
      body: { value },
    }),
  });

  reg.addCall({
    name: "kitchen_remove_task_custom_field",
    description:
      "Clear a custom field value from a task. The field definition on the board is untouched.",
    method: "DELETE",
    inputSchema: {
      task_id: z.string(),
      custom_field_id: z.string().describe("Custom field ID (cf_…)."),
    },
    buildRequest: ({ task_id, custom_field_id }) => ({
      path: `/api/tasks/${encodeURIComponent(task_id)}/custom-fields/${encodeURIComponent(custom_field_id)}`,
    }),
  });
}
