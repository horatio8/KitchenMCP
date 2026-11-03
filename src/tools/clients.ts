import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { expandShape, paginationShape, pickQuery } from "./common.js";

export function registerClientTools(reg: ToolRegistry): void {
  reg.addCall({
    name: "kitchen_list_clients",
    description: "List client users.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      ...expandShape,
      email: z.string().email().optional(),
      company_id: z.string().optional(),
    },
    buildRequest: (input) => ({
      path: "/api/clients",
      query: pickQuery(input, ["page", "per_page", "expand", "email", "company_id"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_client",
    description: "Get a client by ID.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string(), ...expandShape },
    buildRequest: ({ id, expand }) => ({
      path: `/api/clients/${encodeURIComponent(id)}`,
      query: expand ? { expand } : undefined,
    }),
  });

  reg.addCall({
    name: "kitchen_create_client",
    description:
      "Create a client user. The API takes a single 'name', not first/last. Pass 'notification' to send them an invitation message; omit it and they are created silently.",
    method: "POST",
    inputSchema: {
      name: z.string().describe("Full name. Not first_name/last_name."),
      email: z.string().email(),
      title: z.string().optional().describe("Job title."),
      phone: z.string().nullable().optional(),
      notification: z
        .string()
        .optional()
        .describe(
          "Message to send the client. Omit to create them without notifying anyone.",
        ),
    },
    buildRequest: (input) => ({ path: "/api/clients", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_client",
    description: "Update a client.",
    method: "PUT",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      email: z.string().email().optional(),
      username: z.string().optional().describe("Unique username."),
      title: z.string().nullable().optional().describe("Job title."),
      phone: z.string().nullable().optional(),
      color: z.string().optional().describe("Hex colour for the user."),
      language: z.string().optional().describe("ISO language code."),
      timezone: z.string().optional(),
    },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/clients/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_client",
    description: "Permanently delete a client.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/clients/${encodeURIComponent(id)}` }),
  });

  // Companies
  reg.addCall({
    name: "kitchen_list_companies",
    description: "List companies.",
    readOnly: true,
    method: "GET",
    inputSchema: { ...paginationShape, name: z.string().optional() },
    buildRequest: (input) => ({
      path: "/api/companies",
      query: pickQuery(input, ["page", "per_page", "name"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_company",
    description: "Get a company.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/companies/${encodeURIComponent(id)}` }),
  });

  const companyShape = {
    initials: z.string().nullable().optional(),
    website: z.string().nullable().optional().describe("Website URL."),
    email: z.string().nullable().optional().describe("Contact email."),
    phone_number: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
  };

  reg.addCall({
    name: "kitchen_create_company",
    description:
      "Create a company. The name must be unique within the workspace. There is no notes field — use address or the website.",
    method: "POST",
    inputSchema: { name: z.string(), ...companyShape },
    buildRequest: (input) => ({ path: "/api/companies", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_company",
    description: "Update a company.",
    method: "PUT",
    inputSchema: { id: z.string(), name: z.string().optional(), ...companyShape },
    buildRequest: ({ id, ...rest }) => ({
      path: `/api/companies/${encodeURIComponent(id)}`,
      body: rest,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_company",
    description: "Permanently delete a company.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/companies/${encodeURIComponent(id)}` }),
  });
}
