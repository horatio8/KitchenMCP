import { ToolRegistry } from "./registry.js";
import { registerClientTools } from "./clients.js";
import { registerConversationTools } from "./conversations.js";
import { registerDocTools } from "./docs.js";
import { registerFileTools } from "./files.js";
import { registerInvoiceTools } from "./invoices.js";
import { registerRawTool } from "./raw.js";
import { registerStructureTools } from "./structure.js";
import { registerTaskTools } from "./tasks.js";
import { registerWebhookTools } from "./webhooks.js";

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
  registerRawTool(reg);
  return reg;
}

export { ToolRegistry };
