import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { expandShape, paginationShape, pickQuery } from "./common.js";

/**
 * Invoices and recurring invoices.
 *
 * An invoice has no "title" and no "due_date" you can set directly: the
 * due date is derived from `due_date_in_days` after it is finalised.
 * The client reference is `client`, not `client_id`, and `visibility`
 * is required on create like every other container.
 */

const visibility = z
  .enum(["private", "internal", "shared"])
  .describe("Who can see it: 'private', 'internal' (team), 'shared' (team + client).");

/** Line items, discounts and tax items share this loose shape. */
const lineItem = z
  .object({
    title: z.string().optional().describe("Line item title."),
    description: z.string().optional(),
    quantity: z.union([z.number(), z.string()]).optional(),
    amount: z.union([z.number(), z.string()]).optional().describe("Unit amount."),
  })
  .passthrough();

const paymentGateway = z.enum(["credit_card", "stripe_ach", "paypal", "bank"]);

/** Fields shared by invoice create and update. */
const invoiceBodyShape = {
  client: z.string().nullable().optional().describe("Client user ID (u_…)."),
  currency: z.string().length(3).optional().describe("Three-letter ISO code."),
  number: z.string().optional().describe("Unique invoice number."),
  issue_date: z.string().nullable().optional().describe("ISO 8601."),
  due_date_in_days: z
    .number()
    .nullable()
    .optional()
    .describe(
      "Days until due, counted from when the invoice is finalised. There is no direct due_date field.",
    ),
  due_reminder_send_days: z
    .number()
    .nullable()
    .optional()
    .describe("Days before (or after) the due date to send the reminder."),
  due_reminder_message: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  footer_notes: z.string().nullable().optional(),
  language: z.string().optional().describe("Java locale, e.g. 'en_US'."),
  shipping_amount: z.number().optional(),
  payment_gateways: z
    .union([paymentGateway, z.array(paymentGateway)])
    .optional()
    .describe("Only shown if configured on the workspace."),
  items: z.array(lineItem).optional().describe("Invoice line items."),
  tax_items: z.array(lineItem).optional(),
  discounts: z
    .array(lineItem.extend({ type: z.string().optional() }).passthrough())
    .optional()
    .describe("Each discount may carry a type, e.g. 'percentage'."),
};

export function registerInvoiceTools(reg: ToolRegistry): void {
  reg.addCall({
    name: "kitchen_list_invoices",
    description:
      "List invoices. Filter by state and invoice number. There is no client filter — expand 'client' and filter the results.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      ...expandShape,
      state: z.enum(["all", "active", "archived"]).optional(),
      number: z.string().optional().describe("Invoice number to search for."),
    },
    buildRequest: (input) => ({
      path: "/api/invoices",
      query: pickQuery(input, ["page", "per_page", "expand", "state", "number"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_invoice",
    description:
      "Get an invoice by ID. Expandable: billing_profile, client, creator.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string(), ...expandShape },
    buildRequest: ({ id, expand }) => ({
      path: `/api/invoices/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_invoice",
    description:
      "Create an invoice. visibility is required. Note there is no title field, and the due date is set as due_date_in_days rather than a date.",
    method: "POST",
    inputSchema: {
      visibility: visibility.default("shared"),
      folder: z.string().optional().describe("Folder ID (fo_…) to create it in."),
      role: z
        .string()
        .optional()
        .describe(
          "Default team role when visibility is 'internal', e.g. invoice_admin, invoice_viewer.",
        ),
      grand_total: z
        .string()
        .optional()
        .describe("Required only for an external invoice (one backed by a file)."),
      ...invoiceBodyShape,
    },
    buildRequest: (input) => ({ path: "/api/invoices", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_invoice",
    description: "Update an invoice.",
    method: "PUT",
    inputSchema: {
      id: z.string(),
      visibility: visibility.optional(),
      grand_total: z.string().optional(),
      ...invoiceBodyShape,
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/invoices/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_move_invoice",
    description:
      "Move an invoice into a folder. Pass parent: null to move it to the root.",
    method: "POST",
    inputSchema: { id: z.string(), parent: z.string().nullable() },
    buildRequest: ({ id, parent }) => ({
      path: `/api/invoices/${encodeURIComponent(id)}/move`,
      body: { parent },
    }),
  });

  reg.addCall({
    name: "kitchen_archive_invoice",
    description: "Archive an invoice.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/invoices/${encodeURIComponent(id)}/archive`,
    }),
  });

  reg.addCall({
    name: "kitchen_restore_invoice",
    description: "Restore an archived invoice.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/invoices/${encodeURIComponent(id)}/restore`,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_invoice",
    description: "Permanently delete an invoice. Irreversible.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/invoices/${encodeURIComponent(id)}` }),
  });

  /* ---------------------------------------------------------------- */
  /* Recurring invoices                                                */
  /* ---------------------------------------------------------------- */

  const recurringShape = {
    recurring_name: z.string().optional().describe("Name for the schedule."),
    recurring_frequency: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("How many period units between issues."),
    recurring_period_unit: z.enum(["day", "week", "month", "year"]).optional(),
    recurring_start_date: z.string().optional().describe("ISO 8601."),
    recurring_end_date: z.string().nullable().optional().describe("ISO 8601."),
    recurring_send_email_to_client: z.boolean().nullable().optional(),
    recurring_send_email_message: z.string().nullable().optional(),
    recurring_send_email_cc_addresses: z.array(z.string()).nullable().optional(),
    recurring_send_to_conversation: z
      .string()
      .nullable()
      .optional()
      .describe("Conversation ID (convr_…) to post issued invoices into."),
    target_folder: z
      .string()
      .nullable()
      .optional()
      .describe("Folder the issued invoices are filed in."),
    charge_automatically: z
      .boolean()
      .optional()
      .describe("Charge the client automatically when the gateway is credit_card."),
    ...invoiceBodyShape,
  };

  reg.addCall({
    name: "kitchen_list_recurring_invoices",
    description:
      "List recurring invoice schedules. Expandable: billing_profile, client, creator.",
    readOnly: true,
    method: "GET",
    inputSchema: { ...paginationShape, ...expandShape },
    buildRequest: (input) => ({
      path: "/api/recurring-invoices",
      query: pickQuery(input, ["page", "per_page", "expand"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_recurring_invoice",
    description: "Get a recurring invoice schedule by ID.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string(), ...expandShape },
    buildRequest: ({ id, expand }) => ({
      path: `/api/recurring-invoices/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_recurring_invoice",
    description:
      "Create a recurring invoice schedule. The cadence is recurring_frequency × recurring_period_unit, e.g. 1 × month.",
    method: "POST",
    inputSchema: { ...recurringShape },
    buildRequest: (input) => ({ path: "/api/recurring-invoices", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_recurring_invoice",
    description: "Update a recurring invoice schedule.",
    method: "PUT",
    inputSchema: { id: z.string(), ...recurringShape },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/recurring-invoices/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_recurring_invoice",
    description: "Delete a recurring invoice schedule.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/recurring-invoices/${encodeURIComponent(id)}`,
    }),
  });
}
