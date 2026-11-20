/**
 * One-click install of a fresh Flare Stack Blog into a Cloudflare account.
 *
 *   bun run setup
 *   bun run setup -- --email you@example.com --api-key ... --worker my-blog \
 *     --d1 my-blog-db --kv my-blog-kv --r2 my-blog-media
 *
 * The script creates the D1 database, KV namespace, R2 bucket and queue when
 * they do not exist, builds the Worker with `bun run build`, deploys it with
 * the project's own `bun run deploy`, writes the runtime secrets, and deploys
 * once more so the secrets are part of the serving version.
 *
 * Only a Cloudflare email and Global API Key are required. The key is passed
 * to `cf` through CLOUDFLARE_EMAIL / CLOUDFLARE_API_KEY, which `cf` reads
 * before any stored login, and is never written to disk.
 *
 * The blog answers at `--domain` when given, otherwise at
 * <worker>.<account>.workers.dev. GitHub OAuth is not created here: without
 * `--github-id` and `--github-secret` the blog still deploys, but nobody can
 * sign in, because GitHub is the only login that works before mail is set up.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.cloudflare.com/client/v4";
const MIN_BUN = "1.3";
const MIN_NODE_MAJOR = 24;
const MIN_NODE_MINOR = 0;
const WORKERS_DEV_ATTEMPTS = 12;
const WORKERS_DEV_INTERVAL_MS = 5_000;

const USAGE = `usage: bun run setup -- [options]

Creates the Cloudflare resources, builds and deploys the blog, and writes the
runtime secrets. Without options it asks for the values one at a time.

  --email <email>            Cloudflare email        (or CLOUDFLARE_EMAIL)
  --api-key <key>            Global API Key          (or CLOUDFLARE_API_KEY;
                             prefer the prompt or env so it stays out of the
                             shell history)
  --account <id>             Account id, when the key sees several
  --worker <name>            Worker name             (required)
  --d1 <name>                D1 database name        (default <worker>-db)
  --kv <name>                KV namespace name       (default <worker>-kv)
  --r2 <name>                R2 bucket name          (default <worker>-media)
  --queue <name>             Queue name              (default <worker>-queue)
  --domain <domain>          Custom domain; without it the Worker is served
                             at <worker>.<account>.workers.dev
  --github-id <id>           GitHub OAuth Client ID  (or GITHUB_CLIENT_ID)
  --github-secret <secret>   GitHub OAuth secret     (or GITHUB_CLIENT_SECRET)
  --dry-run                  Read and print the plan; change nothing
  --help`;

type CliValues = {
  email?: string;
  "api-key"?: string;
  account?: string;
  worker?: string;
  d1?: string;
  kv?: string;
  r2?: string;
  queue?: string;
  domain?: string;
  "github-id"?: string;
  "github-secret"?: string;
  "dry-run": boolean;
  help: boolean;
};

type Inputs = {
  email: string;
  apiKey: string;
  accountId?: string;
  worker: string;
  d1: string;
  kv: string;
  r2: string;
  queue: string;
  domain?: string;
  githubId: string;
  githubSecret: string;
};

type Auth = { email: string; apiKey: string };

type Account = { id: string; name: string };

type Zone = { id: string; name: string; status: string };

type Existing = {
  d1Id?: string;
  kvId?: string;
  r2: boolean;
  queue: boolean;
  worker: boolean;
};

type Site = { url: string; host: string; workersDev: boolean };

function fail(message: string): never {
  throw new Error(message);
}

function log(message: string): void {
  console.log(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

// --- Interaction ----------------------------------------------------------

let prompts: ReturnType<typeof createInterface> | null = null;

function closePrompts(): void {
  prompts?.close();
  prompts = null;
}

async function textLine(label: string, fallback?: string): Promise<string> {
  if (!process.stdin.isTTY) {
    fail(`${label} 需要在终端中交互输入，或通过命令行参数提供。`);
  }
  prompts ??= createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const suffix = fallback ? `（默认 ${fallback}）` : "";
  const answer = (await prompts.question(`${label}${suffix}：`)).trim();
  return answer || fallback || "";
}

/** Reads the API key without echoing it; the terminal shows one `*` per character. */
async function secretLine(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(
      "当前不是交互终端，无法隐藏输入 API Key；请用 --api-key 或 CLOUDFLARE_API_KEY 提供。",
    );
  }
  closePrompts();
  process.stdout.write(label);
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0003") {
          finish(new Error("已取消。"));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character < " ") continue;
        value += character;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

// --- Validation -----------------------------------------------------------

function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

function validateWorker(name: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) {
    fail(
      `Worker 名称「${name}」不合法：仅限小写字母、数字和连字符，1–63 个字符，且不能以连字符开头或结尾。`,
    );
  }
}

function validateResourceName(label: string, name: string): void {
  if (!/^[\w-]{1,63}$/.test(name)) {
    fail(
      `${label}名称「${name}」不合法：仅限字母、数字、下划线和连字符，1–63 个字符。`,
    );
  }
}

function validateQueueName(name: string): void {
  if (!/^[\w-]{1,63}$/.test(name)) {
    fail(
      `队列名称「${name}」不合法：仅限字母、数字、下划线和连字符，1–63 个字符。`,
    );
  }
}

function validateBucketName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) {
    fail(
      `R2 存储桶名称「${name}」不合法：仅限小写字母、数字和连字符，3–63 个字符，且不能以连字符开头或结尾。`,
    );
  }
}

function validateDomain(domain: string): void {
  if (
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(
      domain,
    )
  ) {
    fail(`域名「${domain}」不合法：请填写纯域名，例如 blog.example.com。`);
  }
}

// --- Command line ---------------------------------------------------------

function parseCli(): CliValues {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      allowPositionals: false,
      options: {
        email: { type: "string" },
        "api-key": { type: "string" },
        account: { type: "string" },
        worker: { type: "string" },
        d1: { type: "string" },
        kv: { type: "string" },
        r2: { type: "string" },
        queue: { type: "string" },
        domain: { type: "string" },
        "github-id": { type: "string" },
        "github-secret": { type: "string" },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
    return values;
  } catch (error) {
    fail(
      `${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`,
    );
  }
}

async function readInputs(values: CliValues): Promise<Inputs> {
  let email = trimmed(values.email) || trimmed(process.env.CLOUDFLARE_EMAIL);
  if (!email) email = await textLine("Cloudflare 账户邮箱");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail(`邮箱「${email}」格式不正确。`);
  }

  let apiKey =
    trimmed(values["api-key"]) || trimmed(process.env.CLOUDFLARE_API_KEY);
  if (!apiKey) apiKey = await secretLine("Cloudflare Global API Key：");
  apiKey = apiKey.trim();

  let worker = trimmed(values.worker);
  if (!worker) worker = await textLine("Worker 名称");
  validateWorker(worker);

  const interactive = process.stdin.isTTY;
  const d1 =
    trimmed(values.d1) ||
    (interactive
      ? await textLine("D1 数据库名称", `${worker}-db`)
      : `${worker}-db`);
  validateResourceName("D1 数据库", d1);

  const kv =
    trimmed(values.kv) ||
    (interactive
      ? await textLine("KV 命名空间名称", `${worker}-kv`)
      : `${worker}-kv`);
  validateResourceName("KV 命名空间", kv);

  const r2 =
    trimmed(values.r2) ||
    (interactive
      ? await textLine("R2 存储桶名称", `${worker}-media`)
      : `${worker}-media`);
  validateBucketName(r2);

  const queue = trimmed(values.queue) || `${worker}-queue`;
  validateQueueName(queue);

  const domain = (
    trimmed(values.domain) ||
    trimmed(process.env.DOMAIN) ||
    (interactive ? await textLine("自定义域名（留空使用 workers.dev）") : "")
  ).toLowerCase();
  if (domain) validateDomain(domain);

  let githubId =
    trimmed(values["github-id"]) || trimmed(process.env.GITHUB_CLIENT_ID);
  let githubSecret =
    trimmed(values["github-secret"]) ||
    trimmed(process.env.GITHUB_CLIENT_SECRET);
  if (interactive && !githubId) {
    githubId = await textLine(
      "GitHub OAuth Client ID（留空则暂时无法登录后台）",
    );
  }
  if (interactive && githubId && !githubSecret) {
    githubSecret = await secretLine("GitHub OAuth Client Secret：");
  }
  if (Boolean(githubId) !== Boolean(githubSecret)) {
    fail(
      "GitHub OAuth 的 Client ID 与 Client Secret 需要同时提供，否则登录无法工作。",
    );
  }

  const accountId =
    trimmed(values.account) || trimmed(process.env.CLOUDFLARE_ACCOUNT_ID);

  return {
    email,
    apiKey,
    ...(accountId ? { accountId } : {}),
    worker,
    d1,
    kv,
    r2,
    queue,
    ...(domain ? { domain } : {}),
    githubId,
    githubSecret,
  };
}

// --- Processes ------------------------------------------------------------

function capture(
  command: string,
  args: Array<string>,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function run(
  command: string,
  args: Array<string>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  log(`\n$ ${command} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: ["inherit", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      if (status === 0) resolve();
      else {
        reject(
          new Error(
            `${command} ${args[0] ?? ""} 失败（${status ?? signal ?? "未知状态"}）。`,
          ),
        );
      }
    });
  });
}

async function checkRuntime(): Promise<void> {
  const bunVersion = (process.versions as unknown as Record<string, string>)
    .bun;
  if (!bunVersion) {
    fail("此脚本需要用 Bun 运行：bun run setup。");
  }
  const [bunMajor, bunMinor] = bunVersion.split(".").map(Number);
  const [minMajor, minMinor] = MIN_BUN.split(".").map(Number);
  if (
    (bunMajor ?? 0) < (minMajor ?? 0) ||
    ((bunMajor ?? 0) === (minMajor ?? 0) && (bunMinor ?? 0) < (minMinor ?? 0))
  ) {
    fail(`需要 Bun >= ${MIN_BUN}（当前 ${bunVersion}）。`);
  }
}

async function ensureDependencies(): Promise<void> {
  const cf = path.join(ROOT, "node_modules", ".bin", "cf");
  if (!existsSync(cf)) {
    log("安装依赖（bun install --frozen-lockfile）…");
    await run(process.execPath, ["install", "--frozen-lockfile"], process.env);
  }

  let nodeVersion: string;
  try {
    const result = await capture("node", ["--version"]);
    nodeVersion = result.status === 0 ? result.stdout.trim() : "";
  } catch {
    nodeVersion = "";
  }
  const nodeMajor = Number(nodeVersion.replace(/^v/, "").split(".")[0]);
  const nodeMinor = Number(nodeVersion.replace(/^v/, "").split(".")[1]) || 0;
  if (
    !nodeVersion ||
    nodeMajor < MIN_NODE_MAJOR ||
    (nodeMajor === MIN_NODE_MAJOR && nodeMinor < MIN_NODE_MINOR)
  ) {
    fail(
      `构建需要 Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}（当前 ${nodeVersion || "未找到 node"}），请安装后重试。`,
    );
  }
}

// --- Cloudflare API -------------------------------------------------------

async function api<T>(
  auth: Auth,
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(API + endpoint, {
    method,
    headers: {
      "X-Auth-Email": auth.email,
      "X-Auth-Key": auth.apiKey,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((error: unknown) =>
    fail(
      `无法连接 Cloudflare API：${error instanceof Error ? error.message : String(error)}`,
    ),
  );

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || payload.success !== true) {
    const messages =
      isRecord(payload) && Array.isArray(payload.errors)
        ? payload.errors
            .map((entry) =>
              isRecord(entry) && typeof entry.message === "string"
                ? entry.message
                : String(entry),
            )
            .join("；")
        : "";
    fail(
      `Cloudflare API ${method} ${endpoint} 失败（HTTP ${response.status}）${
        messages ? `：${messages}` : ""
      }`,
    );
  }
  return payload.result as T;
}

async function resolveAccount(
  auth: Auth,
  wanted: string | undefined,
): Promise<Account> {
  const accounts = await api<Array<Account>>(
    auth,
    "GET",
    "/accounts?per_page=50",
  );
  if (!Array.isArray(accounts) || accounts.length === 0) {
    fail("这个 API Key 看不到任何 Cloudflare 账户。");
  }
  if (wanted) {
    const found = accounts.find((account) => account.id === wanted);
    if (!found) fail(`账户 id「${wanted}」不在这个 API Key 的账户列表中。`);
    return found;
  }
  if (accounts.length === 1) return accounts[0]!;
  if (!process.stdin.isTTY) {
    fail(
      `这个 API Key 可以看到多个账户，需要用 --account 指定其一：\n${accounts
        .map((account) => `  ${account.id}  ${account.name}`)
        .join("\n")}`,
    );
  }
  log("这个 API Key 可以看到多个账户：");
  accounts.forEach((account, index) => {
    log(`  ${index + 1}. ${account.name}（${account.id}）`);
  });
  const answer = await textLine(`选择账户序号（1–${accounts.length}）`);
  const index = Number(answer) - 1;
  if (!Number.isInteger(index) || !accounts[index]) {
    fail(`无效的账户序号：${answer}`);
  }
  return accounts[index]!;
}

async function inspectResources(
  auth: Auth,
  accountId: string,
  inputs: Inputs,
): Promise<Existing> {
  const [d1Rows, kvRows, r2Result, queueRows, scripts] = await Promise.all([
    api<Array<{ uuid: string; name: string }>>(
      auth,
      "GET",
      `/accounts/${accountId}/d1/database?per_page=100`,
    ),
    api<Array<{ id: string; title: string }>>(
      auth,
      "GET",
      `/accounts/${accountId}/storage/kv/namespaces?per_page=1000`,
    ),
    api<{ buckets?: Array<{ name: string }> }>(
      auth,
      "GET",
      `/accounts/${accountId}/r2/buckets?per_page=100`,
    ),
    api<Array<{ queue_id: string; queue_name: string }>>(
      auth,
      "GET",
      `/accounts/${accountId}/queues?per_page=100`,
    ),
    api<Array<{ id?: string }>>(
      auth,
      "GET",
      `/accounts/${accountId}/workers/scripts?per_page=100`,
    ),
  ]);

  const d1 = d1Rows.find((row) => row.name === inputs.d1);
  const kv = kvRows.find((row) => row.title === inputs.kv);
  return {
    ...(d1 ? { d1Id: d1.uuid } : {}),
    ...(kv ? { kvId: kv.id } : {}),
    r2: (r2Result.buckets ?? []).some((bucket) => bucket.name === inputs.r2),
    queue: queueRows.some((row) => row.queue_name === inputs.queue),
    worker: scripts.some((script) => script.id === inputs.worker),
  };
}

async function createMissingResources(
  auth: Auth,
  accountId: string,
  inputs: Inputs,
  existing: Existing,
): Promise<{ d1Id: string; kvId: string }> {
  let d1Id = existing.d1Id;
  if (d1Id) log(`D1 数据库已存在：${inputs.d1}（${d1Id}）`);
  else {
    const created = await api<{ uuid: string }>(
      auth,
      "POST",
      `/accounts/${accountId}/d1/database`,
      { name: inputs.d1 },
    );
    if (!created.uuid) fail("D1 数据库已创建，但响应中没有 UUID。");
    d1Id = created.uuid;
    log(`已创建 D1 数据库：${inputs.d1}（${d1Id}）`);
  }

  let kvId = existing.kvId;
  if (kvId) log(`KV 命名空间已存在：${inputs.kv}（${kvId}）`);
  else {
    const created = await api<{ id: string }>(
      auth,
      "POST",
      `/accounts/${accountId}/storage/kv/namespaces`,
      { title: inputs.kv },
    );
    if (!created.id) fail("KV 命名空间已创建，但响应中没有 id。");
    kvId = created.id;
    log(`已创建 KV 命名空间：${inputs.kv}（${kvId}）`);
  }

  if (existing.r2) log(`R2 存储桶已存在：${inputs.r2}`);
  else {
    try {
      await api(auth, "POST", `/accounts/${accountId}/r2/buckets`, {
        name: inputs.r2,
      });
      log(`已创建 R2 存储桶：${inputs.r2}`);
    } catch (error) {
      fail(
        `${error instanceof Error ? error.message : String(error)}\nR2 需要先在 Cloudflare 控制台开通（绑定付款方式）后才能创建存储桶。`,
      );
    }
  }

  if (existing.queue) log(`队列已存在：${inputs.queue}`);
  else {
    await api(auth, "POST", `/accounts/${accountId}/queues`, {
      queue_name: inputs.queue,
    });
    log(`已创建队列：${inputs.queue}`);
  }

  return { d1Id, kvId };
}

async function findZone(auth: Auth, domain: string): Promise<Zone | null> {
  let candidate = domain;
  while (candidate.includes(".")) {
    const zones = await api<Array<Zone>>(
      auth,
      "GET",
      `/zones?name=${encodeURIComponent(candidate)}&per_page=5`,
    );
    if (zones.length > 0) return zones[0] ?? null;
    const next = candidate.slice(candidate.indexOf(".") + 1);
    if (!next.includes(".")) break;
    candidate = next;
  }
  return null;
}

async function ensureAccountSubdomain(
  auth: Auth,
  accountId: string,
  worker: string,
): Promise<string> {
  try {
    const current = await api<{ subdomain?: string }>(
      auth,
      "GET",
      `/accounts/${accountId}/workers/subdomain`,
    );
    if (current.subdomain) return current.subdomain;
  } catch {
    // 10007 means no workers.dev subdomain is registered yet.
  }

  const candidates = [worker, `${worker}-${randomHex(2)}`];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const created = await api<{ subdomain?: string }>(
        auth,
        "PUT",
        `/accounts/${accountId}/workers/subdomain`,
        { subdomain: candidate },
      );
      log(`已注册 workers.dev 子域：${candidate}.workers.dev`);
      return created.subdomain ?? candidate;
    } catch (error) {
      lastError = error;
    }
  }
  fail(
    `无法注册 workers.dev 子域：${
      lastError instanceof Error ? lastError.message : String(lastError)
    }\n请先在 Cloudflare 控制台启用 Workers，或改用 --domain 指定自定义域名。`,
  );
}

async function enableWorkersDev(
  auth: Auth,
  accountId: string,
  worker: string,
): Promise<void> {
  await api(
    auth,
    "POST",
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(worker)}/subdomain`,
    { enabled: true, previews_enabled: true },
  );
}

async function putSecret(
  auth: Auth,
  accountId: string,
  worker: string,
  name: string,
  text: string,
): Promise<void> {
  await api(
    auth,
    "PUT",
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(worker)}/secrets`,
    { name, text, type: "secret_text" },
  );
}

async function secretNames(
  auth: Auth,
  accountId: string,
  worker: string,
): Promise<Set<string>> {
  try {
    const rows = await api<Array<{ name?: string }>>(
      auth,
      "GET",
      `/accounts/${accountId}/workers/scripts/${encodeURIComponent(worker)}/secrets`,
    );
    return new Set(
      rows
        .map((row) => row.name)
        .filter((name): name is string => typeof name === "string"),
    );
  } catch {
    return new Set();
  }
}

async function writeSecrets(
  auth: Auth,
  accountId: string,
  worker: string,
  site: Site,
  inputs: Inputs,
): Promise<void> {
  // Re-runs keep the existing signing key so nobody is signed out.
  const existing = await secretNames(auth, accountId, worker);
  const secrets: Array<[string, string]> = [
    // Better Auth signs sessions with this; rotating it signs everyone out.
    ["BETTER_AUTH_SECRET", randomHex(32)],
    ["BETTER_AUTH_URL", site.url],
    ["DOMAIN", site.host],
    ["ENVIRONMENT", "prod"],
    // Placeholders keep the Worker's env validation satisfied without GitHub.
    ["GITHUB_CLIENT_ID", inputs.githubId || "not-configured"],
    ["GITHUB_CLIENT_SECRET", inputs.githubSecret || "not-configured"],
  ];
  for (const [name, text] of secrets) {
    if (name === "BETTER_AUTH_SECRET" && existing.has(name)) {
      log("保留现有机密：BETTER_AUTH_SECRET");
      continue;
    }
    await putSecret(auth, accountId, worker, name, text);
    log(`已写入机密：${name}`);
  }
}

// --- Verification ---------------------------------------------------------

async function waitForSite(
  url: string,
): Promise<{ ok: boolean; detail: string }> {
  let detail = "";
  for (let attempt = 1; attempt <= WORKERS_DEV_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status >= 200 && response.status < 400) {
        return { ok: true, detail: `HTTP ${response.status}` };
      }
      detail = `HTTP ${response.status}`;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    if (attempt < WORKERS_DEV_ATTEMPTS) await sleep(WORKERS_DEV_INTERVAL_MS);
  }
  return { ok: false, detail };
}

// --- Main -----------------------------------------------------------------

function deployEnvironment(
  inputs: Inputs,
  accountId: string,
  ids: {
    d1Id: string;
    kvId: string;
  },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_EMAIL: inputs.email,
    CLOUDFLARE_API_KEY: inputs.apiKey,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    WORKER_NAME: inputs.worker,
    D1_DATABASE_ID: ids.d1Id,
    KV_NAMESPACE_ID: ids.kvId,
    BUCKET_NAME: inputs.r2,
    QUEUE_NAME: inputs.queue,
  };
  // A token, a stale domain or route mode in the ambient environment would
  // silently change what `cf` does.
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.ROUTE;
  delete env.ZONE_NAME;
  if (inputs.domain) env.DOMAIN = inputs.domain;
  else delete env.DOMAIN;
  return env;
}

function printSummary(
  inputs: Inputs,
  ids: { d1Id: string; kvId: string },
  site: Site,
  verified: { ok: boolean; detail: string },
): void {
  log("\n部署完成");
  log(`  博客地址：${site.url}`);
  log(`  Worker：${inputs.worker}`);
  log(`  D1 数据库：${inputs.d1}（${ids.d1Id}）`);
  log(`  KV 命名空间：${inputs.kv}（${ids.kvId}）`);
  log(`  R2 存储桶：${inputs.r2}`);
  log(`  队列：${inputs.queue}`);
  if (verified.ok) log(`  访问检查：${verified.detail}`);
  else {
    log(
      `  访问检查：暂时无法访问（${verified.detail}）。域名解析和证书可能需要几分钟。`,
    );
  }

  if (!inputs.githubId) {
    log("\n注意：没有配置 GitHub 登录，当前无法登录后台。");
    log("  GitHub OAuth 是不配置邮件服务时唯一可用的登录方式。");
    log("  1. 打开 https://github.com/settings/applications/new");
    log(`  2. Homepage URL 填 ${site.url}`);
    log(`  3. Callback URL 填 ${site.url}/api/auth/callback/github`);
    log(
      "  4. 重新运行本脚本并带上 --github-id 与 --github-secret（不会重复创建资源）。",
    );
  }

  log("\n第一个通过 GitHub 登录的用户会自动成为管理员。");
}

async function main(): Promise<void> {
  const values = parseCli();
  if (values.help) {
    log(USAGE);
    return;
  }

  await checkRuntime();
  const inputs = await readInputs(values);
  closePrompts();

  const auth: Auth = { email: inputs.email, apiKey: inputs.apiKey };
  const account = await resolveAccount(auth, inputs.accountId);
  closePrompts();
  log(`Cloudflare 账户：${account.name}（${account.id}）`);

  const existing = await inspectResources(auth, account.id, inputs);
  if (existing.worker) {
    log(
      `警告：账户中已有名为 ${inputs.worker} 的 Worker，部署会覆盖它的代码。`,
    );
  }
  if (values["dry-run"]) {
    log("\n部署计划（--dry-run，未做任何修改）");
    log(`  Worker：${inputs.worker}`);
    log(
      `  D1 数据库：${inputs.d1}（${existing.d1Id ? `已存在 ${existing.d1Id}` : "将创建"}）`,
    );
    log(
      `  KV 命名空间：${inputs.kv}（${existing.kvId ? `已存在 ${existing.kvId}` : "将创建"}）`,
    );
    log(`  R2 存储桶：${inputs.r2}（${existing.r2 ? "已存在" : "将创建"}）`);
    log(`  队列：${inputs.queue}（${existing.queue ? "已存在" : "将创建"}）`);
    if (inputs.domain) {
      const zone = await findZone(auth, inputs.domain);
      log(
        `  自定义域名：${inputs.domain}（${zone ? `DNS 区域 ${zone.name}，状态 ${zone.status}` : "DNS 区域不在该账户"}）`,
      );
    } else {
      log(`  访问地址：https://${inputs.worker}.<account>.workers.dev`);
    }
    return;
  }

  await ensureDependencies();
  const ids = await createMissingResources(auth, account.id, inputs, existing);

  let site: Site;
  if (inputs.domain) {
    const zone = await findZone(auth, inputs.domain);
    if (!zone) {
      fail(
        `域名「${inputs.domain}」的 DNS 区域不在这个 Cloudflare 账户中。请先把域名接入 Cloudflare，或省略 --domain 使用 workers.dev。`,
      );
    }
    if (zone.status !== "active") {
      log(
        `警告：DNS 区域 ${zone.name} 的状态是 ${zone.status}，证书签发可能较晚。`,
      );
    }
    site = {
      url: `https://${inputs.domain}`,
      host: inputs.domain,
      workersDev: false,
    };
  } else {
    const subdomain = await ensureAccountSubdomain(
      auth,
      account.id,
      inputs.worker,
    );
    const host = `${inputs.worker}.${subdomain}.workers.dev`;
    site = { url: `https://${host}`, host, workersDev: true };
  }
  log(`博客地址：${site.url}`);

  const env = deployEnvironment(inputs, account.id, ids);

  await run(process.execPath, ["run", "build"], env);
  await run(process.execPath, ["run", "deploy"], env);

  if (site.workersDev) {
    await enableWorkersDev(auth, account.id, inputs.worker);
  }

  await writeSecrets(auth, account.id, inputs.worker, site, inputs);

  // Secrets are kept by `cf deploy`; deploying again makes them part of the
  // version that serves traffic, whichever way the secret endpoint behaves.
  await run(process.execPath, ["run", "deploy"], env);

  log(`\n等待 ${site.url} 响应…`);
  const verified = await waitForSite(site.url);
  printSummary(inputs, ids, site, verified);
}

try {
  await main();
} catch (error) {
  console.error(
    `\n安装未完成：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  closePrompts();
}
