import { z } from "zod";
import type { ToolContext, ToolRegistry } from "./registry.js";
import { paginationShape, pickQuery } from "./common.js";
import {
  folderNotChosen,
  folderNotShared,
  getFolder,
  isGoogleDocUrl,
  listSharedFolders,
  needsLinkSharing,
  noSharedFolder,
  normaliseGoogleDocUrl,
  targetIsClient,
  type NeedsAnswer,
} from "./client-sharing.js";

/**
 * Embeds: third-party pages rendered inside Kitchen.
 *
 * These matter more than the name suggests. A Kitchen doc has no
 * writable body — the API exposes title, description and visibility
 * and nothing else — so a doc can be created for a client but never
 * filled. An embed is the way out: it holds a URL, so the document
 * lives somewhere with a real editor (a Google Doc, typically) while
 * still appearing inside the client's folder in the portal.
 *
 * That is what makes the approval pattern work. The client edits
 * genuinely collaborative text with version history and suggestions;
 * the agency keeps a copy under its own Drive structure; and the
 * portal stays the single place the client looks. See
 * docs/APPROVAL-PATTERN.md.
 *
 * Roles are `embed_admin`, `embed_manager`, `embed_viewer` — note
 * these do not follow the doc roles, which are spelled `document_*`
 * against a resource called `doc`.
 */
export function registerEmbedTools(reg: ToolRegistry): void {
  const visibility = z
    .enum(["private", "internal", "shared"])
    .describe("Required by the API. Use 'shared' for anything a client must see.");

  const embedRole = z
    .enum(["embed_admin", "embed_manager", "embed_viewer"])
    .describe("Required by the API. Note: embed_*, not document_*.");

  /** Shared-folder precondition, as for docs. */
  async function requireSharedClientFolder(
    ctx: ToolContext,
    what: string,
  ): Promise<NeedsAnswer | null> {
    const shared = await listSharedFolders(ctx);
    return shared.length ? null : noSharedFolder(what);
  }

  reg.addCall({
    name: "kitchen_list_embeds",
    description:
      "List embeds — third-party pages rendered inside Kitchen, such as a Google Doc a client edits in place.",
    readOnly: true,
    method: "GET",
    inputSchema: {
      ...paginationShape,
      state: z.enum(["active", "archived", "all"]).optional(),
      title: z.string().optional(),
    },
    buildRequest: (input) => ({
      path: "/api/embeds",
      query: pickQuery(input, ["page", "per_page", "state", "title"]),
    }),
  });

  reg.addCall({
    name: "kitchen_get_embed",
    description: "Retrieve an embed by ID (pe_…), including the URL it points at.",
    readOnly: true,
    method: "GET",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/embeds/${encodeURIComponent(id)}` }),
  });

  reg.addCall({
    name: "kitchen_create_embed",
    description:
      "Create an embed: a third-party page shown inside Kitchen. title, url and visibility are required. " +
      "This is how a client gets a document they can actually edit — a Kitchen doc has no writable body, so put the text in a Google Doc and embed its URL. " +
      "For client-facing embeds pass visibility 'shared' and name a shared 'folder'; if no shared folder exists this tool stops and asks rather than filing client work at the root. " +
      "A Google document must be shared with 'anyone with the link' before it is embedded, or the client meets a sign-in wall inside the portal; set that in Drive, then pass link_sharing_confirmed: true. Account-scoped /u/<n>/ URLs are stripped automatically because they fail for everyone but their author.",
    method: "POST",
    inputSchema: {
      title: z.string(),
      url: z.string().describe("The page to embed, e.g. a Google Docs /edit URL."),
      visibility: visibility.default("private"),
      description: z
        .string()
        .optional()
        .describe("Shown under the title. Use it to say what the client should do."),
      folder: z.string().optional().describe("Folder ID (fo_…) to create it in."),
      role: z
        .string()
        .optional()
        .describe("Default team role when visibility is 'internal', e.g. embed_viewer."),
      link_sharing_confirmed: z
        .boolean()
        .optional()
        .describe(
          "Required for a Google document: state that it is shared with 'anyone with the link'. This server cannot check Drive, so this is your attestation, not a verification.",
        ),
    },
    buildRequest: ({ link_sharing_confirmed: _confirmed, ...input }) => ({
      path: "/api/embeds",
      body: { ...input, url: normaliseGoogleDocUrl(input.url).url },
    }),
    preflight: async (input, ctx) => {
      // A Google document that needs a login is worse than no embed.
      if (isGoogleDocUrl(input.url) && !input.link_sharing_confirmed) {
        return needsLinkSharing(input.url, input.visibility === "shared");
      }
      if (input.visibility !== "shared") return null;
      const shared = await listSharedFolders(ctx);
      if (!shared.length) return noSharedFolder("creating a client-visible embed");
      if (!input.folder) return folderNotChosen(shared, input as Record<string, unknown>);
      const folder = await getFolder(ctx, input.folder);
      if (folder && folder.visibility !== "shared") {
        return folderNotShared(folder, shared, input as Record<string, unknown>);
      }
      return null;
    },
  });

  reg.addCall({
    name: "kitchen_update_embed",
    description: "Update an embed. Any parameter not provided is left unchanged.",
    method: "PUT",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      url: z.string().optional(),
      description: z.string().optional(),
      visibility: visibility.optional(),
      link_sharing_confirmed: z
        .boolean()
        .optional()
        .describe(
          "Required when pointing this embed at a Google document: state that it is shared with 'anyone with the link'.",
        ),
    },
    buildRequest: ({ id, link_sharing_confirmed: _confirmed, ...rest }) => ({
      path: `/api/embeds/${encodeURIComponent(id)}`,
      body: rest.url ? { ...rest, url: normaliseGoogleDocUrl(rest.url).url } : rest,
    }),
    preflight: async (input, ctx) => {
      if (input.url && isGoogleDocUrl(input.url) && !input.link_sharing_confirmed) {
        return needsLinkSharing(input.url, input.visibility !== "private");
      }
      return input.visibility === "shared"
        ? requireSharedClientFolder(ctx, "sharing this embed with clients")
        : null;
    },
  });

  reg.addCall({
    name: "kitchen_move_embed",
    description:
      "Move an embed into a folder. Pass parent: null to move it to the root.",
    method: "POST",
    inputSchema: { id: z.string(), parent: z.string().nullable() },
    buildRequest: ({ id, parent }) => ({
      path: `/api/embeds/${encodeURIComponent(id)}/move`,
      body: { parent },
    }),
  });

  reg.addCall({
    name: "kitchen_archive_embed",
    description: "Archive an embed.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/embeds/${encodeURIComponent(id)}/archive`,
    }),
  });

  reg.addCall({
    name: "kitchen_restore_embed",
    description: "Restore an archived embed.",
    method: "POST",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({
      path: `/api/embeds/${encodeURIComponent(id)}/restore`,
    }),
  });

  reg.addCall({
    name: "kitchen_delete_embed",
    description: "Permanently delete an embed.",
    destructive: true,
    method: "DELETE",
    inputSchema: { id: z.string() },
    buildRequest: ({ id }) => ({ path: `/api/embeds/${encodeURIComponent(id)}` }),
  });

  // Embed memberships
  reg.addCall({
    name: "kitchen_list_embed_memberships",
    description: "List memberships for an embed.",
    readOnly: true,
    method: "GET",
    inputSchema: { embed_id: z.string() },
    buildRequest: ({ embed_id }) => ({
      path: `/api/embeds/${encodeURIComponent(embed_id)}/memberships`,
    }),
  });

  reg.addCall({
    name: "kitchen_create_embed_membership",
    description:
      "Give a user or a company access to an embed. role is required, and you pass either 'user' or 'company', not both. Omit 'notification' and nobody is emailed. " +
      "As with docs, the embed's visibility must already be 'shared' before a client can be added. Client grants also require a shared client folder to exist; if none does, this tool stops and asks.",
    method: "POST",
    inputSchema: {
      embed_id: z.string(),
      role: embedRole,
      user: z.string().optional().describe("User ID (u_…). Either this or company."),
      company: z.string().optional().describe("Company ID (co_…). Either this or user."),
      notification: z
        .string()
        .optional()
        .describe("Message to send them. Omit to add them silently."),
    },
    buildRequest: ({ embed_id, ...rest }) => ({
      path: `/api/embeds/${encodeURIComponent(embed_id)}/memberships`,
      body: rest,
    }),
    preflight: async (input, ctx) => {
      if (!(await targetIsClient(ctx, input))) return null;
      return requireSharedClientFolder(ctx, "granting a client access to this embed");
    },
  });

  reg.addCall({
    name: "kitchen_update_embed_membership",
    description: "Change an embed membership's role.",
    method: "PUT",
    inputSchema: {
      embed_id: z.string(),
      membership_id: z.string().describe("Membership ID (nms_…)."),
      role: embedRole,
    },
    buildRequest: ({ embed_id, membership_id, role }) => ({
      path: `/api/embeds/${encodeURIComponent(embed_id)}/memberships/${encodeURIComponent(membership_id)}`,
      body: { role },
    }),
  });

  reg.addCall({
    name: "kitchen_delete_embed_membership",
    description: "Remove a user or company from an embed.",
    method: "DELETE",
    inputSchema: {
      embed_id: z.string(),
      membership_id: z.string().describe("Membership ID (nms_…)."),
    },
    buildRequest: ({ embed_id, membership_id }) => ({
      path: `/api/embeds/${encodeURIComponent(embed_id)}/memberships/${encodeURIComponent(membership_id)}`,
    }),
  });
}
