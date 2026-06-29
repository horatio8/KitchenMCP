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
    description: "Create a client user.",
    method: "POST",
    inputSchema: {
      first_name: z.string(),
      last_name: z.string().optional(),
      email: z.string().email(),
      company_id: z.string().optional(),
      phone: z.string().optional(),
    },
    buildRequest: (input) => ({ path: "/api/clients", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_client",
    description: "Update a client.",
    method: "PATCH",
    inputSchema: {
      id: z.string(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().email().optional(),
      company_id: z.string().nullable().optional(),
      phone: z.string().optional(),
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

  reg.addCall({
    name: "kitchen_create_company",
    description: "Create a company.",
    method: "POST",
    inputSchema: {
      name: z.string(),
      website: z.string().optional(),
      notes: z.string().optional(),
    },
    buildRequest: (input) => ({ path: "/api/companies", body: input }),
  });

  reg.addCall({
    name: "kitchen_update_company",
    description: "Update a company.",
    method: "PATCH",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      website: z.string().optional(),
      notes: z.string().optional(),
    },
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
