// API server: Mongo repos + one pipeline (one LLM client) + in-process job runner. Usage: npm run dev:api
import { setServers } from "node:dns";
import { config } from "./config.ts";
import { createApp } from "./http/app.ts";
import { recoverJobs } from "./jobs/recover.ts";
import { Regenerator } from "./jobs/regenerate.ts";
import { JobRunner } from "./jobs/runner.ts";
import { connectMongo } from "./persistence/mongo.ts";
import { createPipelineDeps } from "./pipeline/deps.ts";
import { runPipeline } from "./pipeline/runPipeline.ts";

const API_TIMEOUT_MS = 300_000;

if (!config.MONGODB_URI) {
  console.error("MONGODB_URI is not set: the API needs MongoDB (see .env.example). npm run evaluate works without it.");
  process.exit(1);
}
if (config.DNS_SERVERS) setServers(config.DNS_SERVERS.split(",").map((s) => s.trim()));

const { repos, close } = await connectMongo(config.MONGODB_URI, config.MONGODB_DB);
const pipeline = createPipelineDeps(config, {
  onLLMEvent: (e) => {
    if (e.type !== "rate_limited" || e.waitMs > 5000) console.log(`[llm] ${e.type} ${JSON.stringify(e).slice(0, 160)}`);
  },
});
const runner = new JobRunner(repos.kits, (input, onProgress) => runPipeline(input, { ...pipeline, onProgress }, { timeoutMs: API_TIMEOUT_MS }));

const recovered = await recoverJobs(repos.kits, runner);
if (recovered.requeued || recovered.interrupted || recovered.regenerationsInterrupted) {
  console.log(`Recovered: ${recovered.requeued} kit(s) re-queued, ${recovered.interrupted} kit(s) and ${recovered.regenerationsInterrupted} regeneration(s) marked INTERRUPTED`);
}

const regen = new Regenerator(repos.kits, pipeline); // same LLM client (and pacing) as generation jobs
const app = createApp({ repos, jobs: runner, regen, webOrigin: config.WEB_ORIGIN });
const server = app.listen(config.PORT, () => console.log(`prepkit API on http://localhost:${config.PORT} (db "${config.MONGODB_DB}")`));

const shutdown = () => {
  console.log("Shutting down");
  server.close(() => void close().then(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
