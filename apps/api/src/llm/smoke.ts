// Usage: npm run llm:smoke -w @prepkit/api [-- --provider gemini]
import { z } from "zod";
import { config } from "../config.ts";
import { LLMClient, providersFromConfig } from "./client.ts";
import { generateJson } from "./json.ts";

const flag = process.argv.indexOf("--provider");
const only = flag >= 0 ? process.argv[flag + 1] : undefined;
const providers = providersFromConfig(config, only);

if (providers.length === 0) {
  console.log(`No LLM provider configured${only ? ` for "${only}"` : ""}: set the API key in .env (see .env.example).`);
  process.exit(0);
}

const client = new LLMClient({
  providers,
  timeoutMs: config.LLM_TIMEOUT_MS,
  onEvent: (e) => console.log("event:", JSON.stringify(e)),
});

const result = await generateJson(client, {
  system: 'Reply with a JSON object of the form {"ok": boolean, "echo": string}.',
  user: 'Set ok to true and echo to "prepkit smoke test".',
  schema: z.object({ ok: z.boolean(), echo: z.string() }),
  maxTokens: 300,
  label: "smoke",
});

console.log("result:", JSON.stringify(result.data));
console.log(`provider: ${result.provider}  model: ${result.model}  tokens: ${result.usage.total_tokens}  repaired: ${result.repaired}`);
