import { ToolRegistry } from "./registry.js";
import { registerClientTools } from "./clients.js";
import { registerConversationTools } from "./conversations.js";
import { registerCustomFieldTools } from "./custom-fields.js";
import { registerDocTools } from "./docs.js";
import { registerFileTools } from "./files.js";
import { registerInvoiceTools } from "./invoices.js";
import { registerRawTool } from "./raw.js";
import { registerStructureTools } from "./structure.js";
import { registerTaskTools } from "./tasks.js";
import { registerWebhookTools } from "./webhooks.js";
import { registerWorkflowTools } from "./workflow.js";

/**
 * The deliverable-workflow tools are disabled.
 *
 * They are a layer on top of the Kitchen API — state machine, gates,
 * compliance engine, evidence register — built against a brief that is
 * now closed. The code is left in place and is inert: nothing here
 * registers it, nothing in the webhook path calls it.
 *
 * Set WORKFLOW_TOOLS=1 to register the 19 workflow_* tools again.
 */
const WORKFLOW_TOOLS_ENABLED = /^(1|true|yes|on)$/i.test(
  process.env.WORKFLOW_TOOLS?.trim() ?? "",
);

export function buildToolRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  registerTaskTools(reg);
  registerDocTools(reg);
  registerClientTools(reg);
  registerInvoiceTools(reg);
  registerConversationTools(reg);
  registerStructureTools(reg);
  registerWebhookTools(reg);
  registerFileTools(reg);
  registerCustomFieldTools(reg);
  if (WORKFLOW_TOOLS_ENABLED) registerWorkflowTools(reg);
  registerRawTool(reg);
  return reg;
}

export { ToolRegistry };
