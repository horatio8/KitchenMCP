import { z } from "zod";
import type { ToolRegistry } from "./registry.js";
import { paginationShape, pickQuery } from "./common.js";

/**
 * Files.
 *
 * Upload is three steps and the middle one is not an API call:
 *   1. POST /api/files with a filename → { id, upload_url }
 *   2. PUT the raw bytes to upload_url (expires after 5 minutes)
 *   3. POST /api/files/{id}/complete within 24 hours
 *
 * Step 2 cannot be done through this server — it is a direct PUT to
 * presigned storage with the file's real Content-Type, and MCP has no
 * way to hand over bytes. The client does it.
 *
 * A completed file can be attached exactly once: to a message, to a
 * task comment, or to a folder. Attaching it anywhere consumes it. That
 * matters for the workflow's record pack — a creative pinned to an
 * approval comment cannot also be filed in the deliverable's folder, so
 * upload it twice if both are wanted.
 */
export function registerFileTools(reg: ToolRegistry): void {
  reg.addCall({
    name: "kitchen_create_file_upload",
    description:
      "Step 1 of an upload: reserve a file and get a presigned upload_url. Takes only 'filename' — size and MIME type are inferred from the bytes you PUT. The caller must then PUT the raw bytes to upload_url (valid 5 minutes, set the real Content-Type) and call kitchen_complete_file within 24 hours. Rate limit: 5 per minute.",
    method: "POST",
    inputSchema: {
      filename: z
        .string()
        .describe("Name of the file, e.g. 'creative-v3.png'. Not 'name'."),
    },
    buildRequest: ({ filename }) => ({
      path: "/api/files",
      body: { filename },
    }),
  });

  reg.addCall({
    name: "kitchen_complete_file",
    description:
      "Step 3 of an upload: finalise a file whose bytes have been PUT to its upload_url. Must happen within 24 hours or the upload is deleted. Returns the file object. The file can then be attached exactly once — to a message, a task comment, or a folder.",
    method: "POST",
    inputSchema: { id: z.string().describe("File ID (fi_…).") },
    buildRequest: ({ id }) => ({
      path: `/api/files/${encodeURIComponent(id)}/complete`,
    }),
  });

  reg.addCall({
    name: "kitchen_get_file",
    description:
      "Retrieve a file's metadata, including its url, thumbnail, where it is attached (location_type, location) and whether it has been approved.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/files/${encodeURIComponent(id)}` }),
  });

  reg.addCall({
    name: "kitchen_delete_file",
    description: "Permanently delete a file. Irreversible.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/files/${encodeURIComponent(id)}` }),
  });

  /* ---------------------------------------------------------------- */
  /* Files in folders                                                  */
  /* ---------------------------------------------------------------- */

  reg.addCall({
    name: "kitchen_list_folder_files",
    description: "List the files filed in a folder.",
    readOnly: true,
    method: "GET",
    inputSchema: { folder_id: z.string(), ...paginationShape },
    buildRequest: ({ folder_id, ...rest }) => ({
      path: `/api/folders/${encodeURIComponent(folder_id)}/files`,
      query: pickQuery(rest, ["page", "per_page"]),
    }),
  });

  reg.addCall({
    name: "kitchen_add_folder_files",
    description:
      "File completed uploads into a folder. Each file can be used only once — once it is in a folder it cannot also be attached to a message or comment, or moved to another folder.",
    method: "POST",
    inputSchema: {
      folder_id: z.string(),
      files: z.array(z.string()).min(1).describe("File IDs (fi_…). Required."),
    },
    buildRequest: ({ folder_id, files }) => ({
      path: `/api/folders/${encodeURIComponent(folder_id)}/files`,
      body: { files },
    }),
  });
}
