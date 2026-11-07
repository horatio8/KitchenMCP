import { callKitchen, KitchenApiError } from "../kitchen/client.js";
import type { ToolContext } from "./registry.js";

/**
 * The shared-client-folder precondition.
 *
 * Client work belongs in a folder that is actually shared with the
 * client. Kitchen will not stop you getting this wrong: it lets a doc
 * sit at the workspace root, or inside a private folder, and still be
 * handed to a client by membership. The result is client-facing
 * material filed where nobody expects to find it, and an agency that
 * cannot answer "where is everything for this client" from the portal.
 *
 * Kitchen does enforce one half of it, in a way worth recording,
 * because it is in none of the published docs: adding a client to a
 * doc whose visibility is `private` fails with
 *
 *   400 "Could not add a client, because the resource is not shared."
 *
 * So visibility must be `shared` before any client membership will
 * take. Nothing, however, checks *where* the doc lives.
 *
 * These guards close that half. Any operation that exposes a doc to a
 * client first establishes that a shared folder for client work
 * exists. If none does, the tool does not quietly create one and does
 * not proceed — it returns a question for the person driving the
 * request, with the exact call that would set one up. Choosing how a
 * client's workspace is organised is their decision, not ours.
 */

export interface FolderSummary {
  id: string;
  name: string;
  visibility: string;
  description: string | null;
}

interface FolderListResponse {
  data?: Array<{
    id?: string;
    name?: string;
    visibility?: string;
    description?: string | null;
    archived_at?: string | null;
  }>;
}

/** Active folders whose visibility is `shared` — i.e. visible to clients. */
export async function listSharedFolders(ctx: ToolContext): Promise<FolderSummary[]> {
  const res = (await callKitchen(ctx.credentials, {
    method: "GET",
    path: "/api/folders",
    query: { state: "active", per_page: 100 },
  })) as FolderListResponse;

  return (res.data ?? [])
    .filter((f) => f.visibility === "shared" && !f.archived_at && f.id)
    .map((f) => ({
      id: String(f.id),
      name: String(f.name ?? ""),
      visibility: String(f.visibility),
      description: f.description ?? null,
    }));
}

export async function getFolder(
  ctx: ToolContext,
  id: string,
): Promise<FolderSummary | null> {
  try {
    const f = (await callKitchen(ctx.credentials, {
      method: "GET",
      path: `/api/folders/${encodeURIComponent(id)}`,
    })) as FolderSummary | null;
    return f && (f as any).id ? f : null;
  } catch {
    return null;
  }
}

/** What a tool returns instead of acting, when the caller must ask first. */
export interface NeedsAnswer {
  status: "needs_user_decision";
  reason: string;
  message: string;
  question: string;
  /** Calls the caller can make once the person has answered. */
  options: Array<{ label: string; tool: string; arguments: Record<string, unknown> }>;
  shared_folders?: FolderSummary[];
}

export function isNeedsAnswer(value: unknown): value is NeedsAnswer {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as NeedsAnswer).status === "needs_user_decision"
  );
}

/**
 * No shared folder exists anywhere in the workspace, so there is
 * nowhere legitimate for client-facing work to live yet.
 */
export function noSharedFolder(what: string, clientName?: string): NeedsAnswer {
  const suffix = clientName ? ` for ${clientName}` : "";
  return {
    status: "needs_user_decision",
    reason: "no_shared_client_folder",
    message:
      `Stopped before ${what}. This workspace has no shared folder, so there is ` +
      `nowhere for client-facing work to live. A doc shared with a client while ` +
      `filed at the root, or inside a private folder, is visible to them but ` +
      `findable by nobody — including you.`,
    question:
      `There's no shared client folder in this workspace. Do you want me to set one up${suffix}? ` +
      `The usual pattern is one shared folder per client, with "1. Drafts", ` +
      `"2. For Approval" and "3. Approved" inside it.`,
    options: [
      {
        label: "Create a shared client folder, then retry",
        tool: "kitchen_create_folder",
        arguments: {
          name: clientName ? `${clientName}: Client Work` : "Client Work",
          visibility: "shared",
          description: "Shared folder for client-facing documents and approvals.",
        },
      },
    ],
  };
}

/** Shared folders exist, but the caller named one that is not shared. */
export function folderNotShared(
  folder: FolderSummary,
  shared: FolderSummary[],
  docArgs: Record<string, unknown>,
): NeedsAnswer {
  return {
    status: "needs_user_decision",
    reason: "folder_not_shared",
    message:
      `Stopped: folder "${folder.name}" (${folder.id}) has visibility ` +
      `"${folder.visibility}", not "shared". A client-visible doc inside a ` +
      `folder the client cannot open is reachable by direct link only. Kitchen ` +
      `permits this; it is almost never what was meant.`,
    question:
      `"${folder.name}" isn't shared with clients. File this in one of the ` +
      `shared folders below instead, or shall I set up a new shared client folder?`,
    shared_folders: shared,
    options: [
      {
        label: "Use an existing shared folder (pick one from shared_folders)",
        tool: "kitchen_create_doc",
        arguments: { ...docArgs, folder: "<id from shared_folders>" },
      },
      {
        label: "Create a new shared client folder",
        tool: "kitchen_create_folder",
        arguments: {
          name: "Client Work",
          visibility: "shared",
          description: "Shared folder for client-facing documents and approvals.",
        },
      },
    ],
  };
}

/** Shared folders exist, but the caller did not say which one to use. */
export function folderNotChosen(
  shared: FolderSummary[],
  docArgs: Record<string, unknown>,
): NeedsAnswer {
  return {
    status: "needs_user_decision",
    reason: "shared_folder_not_specified",
    message:
      `Stopped before creating a client-visible doc with no folder. It would ` +
      `land at the workspace root, outside every client folder. ` +
      `${shared.length} shared folder(s) are available.`,
    question:
      `Which shared client folder should this go in? The existing ones are ` +
      `listed in shared_folders. If none of them fits, I can set up a new one.`,
    shared_folders: shared,
    options: [
      {
        label: "File it in an existing shared folder",
        tool: "kitchen_create_doc",
        arguments: { ...docArgs, folder: "<id from shared_folders>" },
      },
      {
        label: "Create a new shared client folder first",
        tool: "kitchen_create_folder",
        arguments: {
          name: "Client Work",
          visibility: "shared",
          description: "Shared folder for client-facing documents and approvals.",
        },
      },
    ],
  };
}

/**
 * Is this membership target a client rather than a teammate?
 *
 * A company is always a client organisation. A bare user id could be
 * either, and there is no /api/users/{id} endpoint — that 404s. The
 * client register is the discriminator: /api/clients/{id} returns the
 * user with group "client", and 404s ("No query results for model
 * [App\\User]") for a team member. Both were checked against the live
 * API; neither is documented.
 *
 * A 404 therefore means teammate, and the guard is skipped. Any other
 * failure — network, 5xx — is treated as a client, since guarding a
 * teammate needlessly is far cheaper than letting a client doc slip
 * out unfiled.
 */
export async function targetIsClient(
  ctx: ToolContext,
  args: { user?: string | undefined; company?: string | undefined },
): Promise<boolean> {
  if (args.company) return true;
  if (!args.user) return false;
  try {
    const u = (await callKitchen(ctx.credentials, {
      method: "GET",
      path: `/api/clients/${encodeURIComponent(args.user)}`,
    })) as { group?: string } | null;
    return u ? u.group !== "manager" : true;
  } catch (err) {
    if (err instanceof KitchenApiError && err.status === 404) return false;
    return true;
  }
}
