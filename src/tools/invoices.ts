import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { expandShape, paginationShape, pickQuery } from "./common.js";

export function registerInvoiceTools(reg: ToolRegistry): void {
  reg.addCall({
    name: "kitchen_list_invoices",
    description: "List invoices. Filter by state and client.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      ...expandShape,
      state: z.enum(["active", "archived", "all"]).optional(),
      client_id: z.string().optional(),
    },
    buildRequest: (input) => ({
      path: "/api/invoices",
      query: pickQuery(input, ["page", "per_page", "expand", "state", "client_id"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_invoice",
    description: "Get an invoice by ID.",
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
    description: "Create a new invoice.",
    method: "POST",
    inputSchema: {
      client_id: z.string(),
      title: z.string().optional(),
      due_date: z.string().optional(),
      currency: z.string().length(3).optional(),
      auto_charge: z.boolean().optional(),
      items: z
        .array(
          z.object({
            description: z.string(),
            quantity: z.number().positive(),
            unit_amount: z.number(),
          }),
        )
        .optional(),
    },
    buildRequest: (input) => ({ path: "/api/invoices", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_invoice",
    description: "Update an invoice.",
    method: "PATCH",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      due_date: z.string().nullable().optional(),
      auto_charge: z.boolean().optional(),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/invoices/${encodeURIComponent(id)}`,
      body: rest,
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
    description: "Permanently delete an invoice.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/invoices/${encodeURIComponent(id)}` }),
  });

  // Recurring invoices
  reg.addCall({
    name: "kitchen_list_recurring_invoices",
    description: "List recurring invoices.",
    readOnly: true,
    method: "GET",
    inputSchema: { ...paginationShape, client_id: z.string().optional() },
    buildRequest: (input) => ({
      path: "/api/recurring-invoices",
      query: pickQuery(input, ["page", "per_page", "client_id"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_recurring_invoice",
    description: "Get a recurring invoice by ID.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/recurring-invoices/${encodeURIComponent(id)}`,
    }),
  });

  reg.addCall({
    name: "kitchen_create_recurring_invoice",
    description: "Create a recurring invoice schedule.",
    method: "POST",
    inputSchema: {
      client_id: z.string(),
      interval: z.enum(["day", "week", "month", "year"]),
      interval_count: z.number().int().positive(),
      starts_at: z.string().describe("ISO 8601 timestamp"),
      ends_at: z.string().optional(),
      items: z.array(
        z.object({
          description: z.string(),
          quantity: z.number().positive(),
          unit_amount: z.number(),
        }),
      ),
    },
    buildRequest: (input) => ({ path: "/api/recurring-invoices", body: input }),
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
