import { z } from "zod";
import type { ToolRegistry } from "./registry.js";

export function registerFileTools(reg: ToolRegistry): void {
  reg.addCall({
    name: "kitchen_create_file_upload",
    description:
      "Create a file upload. Returns the file object plus a presigned upload URL. Caller must PUT bytes to the upload URL, then call kitchen_complete_file. Limited to 5 uploads/minute.",
    method: "POST",
    inputSchema: {
      name: z.string(),
      size: z.number().int().nonnegative(),
      mime_type: z.string().optional(),
    },
    buildRequest: (input) => ({ path: "/api/files", body: input }),
  });

  reg.addCall({
    name: "kitchen_complete_file",
    description: "Finalize a file upload created via kitchen_create_file_upload. Must be called within 24h of creation.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/files/${encodeURIComponent(id)}/complete`,
    }),
  });

  reg.addCall({
    name: "kitchen_get_file",
    description: "Retrieve a file's metadata.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/files/${encodeURIComponent(id)}` }),
  });

  reg.addCall({
    name: "kitchen_delete_file",
    description: "Permanently delete a file.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/files/${encodeURIComponent(id)}` }),
  });
}
