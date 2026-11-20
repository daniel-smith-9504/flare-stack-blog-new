/**
 * One-click setup for a Flare Stack Blog that is already connected to
 * Cloudflare Workers Builds.
 *
 * Before asking for credentials the script prints the three things the user
 * has to prepare: the GitHub OAuth App link, the R2/GitHub binding reminder,
 * and the .git URL of their own fork. It then asks for the Cloudflare email +
 * Global API Key and the OAuth App's Client ID/Secret, and runs on its own:
 *
 *  - finds the Worker whose Workers Builds configuration watches that repo;
 *  - creates D1, KV, R2 and the queue, named after the Worker;
 *  - writes the build variables and the runtime secrets;
 *  - starts a build, and a second one only if the Worker does not exist yet;
 *  - checks that the site answers.
 *
 * The deployment itself still goes through Workers Builds, so "Sync fork"
 * keeps deploying exactly as docs/deployment.md describes.
 */
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

const API = "https://api.cloudflare.com/client/v4";
const OAUTH_APP_URL = "https://github.com/settings/applications/new";
const R2_URL = "https://dash.cloudflare.com/?to=/:account/r2";
const WORKERS_URL =
  "https://dash.cloudflare.com/?to=/:account/workers-and-pages";
const BUILD_POLL_MS = 15_000;
const BUILD_MAX_POLLS = 160;
const SITE_ATTEMPTS = 24;
const SITE_INTERVAL_MS = 5_000;

const USAGE = `usage: bun run setup [options]

先完成三件事，再运行本脚本：

  1. 创建 GitHub OAuth App：${OAUTH_APP_URL}
     Homepage URL            https://你的博客域名
     Authorization callback  https://你的博客域名/api/auth/callback/github
  2. 开通 R2（需要绑定付款方式）：${R2_URL}
     并把 GitHub 账号连接到 Cloudflare，把你的 fork 连接成 Worker：
     ${WORKERS_URL}
  3. 准备好你自己的 fork 仓库地址，必须以 .git 结尾。

脚本会要求 Cloudflare 邮箱、Global API Key、OAuth App 的 Client ID 和
Client Secret，然后自动完成其余步骤。

  --repo <url>            GitHub fork 地址，.git 结尾（或 REPO_URL）
  --email <email>         Cloudflare 邮箱        （或 CLOUDFLARE_EMAIL）
  --api-key <key>         Global API Key         （或 CLOUDFLARE_API_KEY）
  --github-id <id>        OAuth App Client ID     （或 GITHUB_CLIENT_ID）
  --github-secret <s>     OAuth App Client Secret （或 GITHUB_CLIENT_SECRET）
  --account <id>          账户 id，当密钥可见多个账户时
  --domain <domain>       覆盖自动检测到的博客域名
  --dry-run               只读取并打印计划，不做任何修改
  --help`;

type CliValues = {
  repo?: string;
  email?: string;
  "api-key"?: string;
  "github-id"?: string;
  "github-secret"?: string;
  account?: string;
  domain?: string;
  "dry-run": boolean;
  help: boolean;
};

type Repo = {
  owner: string;
  name: string;
  fullName: string;
  url: string;
};

type Inputs = {
  repo: Repo;
  email: string;
  apiKey: string;
  accountId?: string;
  githubId: string;
  githubSecret: string;
  domain?: string;
};

type Auth = { email: string; apiKey: string };

type Account = { id: string; name: string };

type Script = { id: string; tag?: string };

type EnvironmentVariable = string | { value?: string; is_secret?: boolean };

type BuildSettings = {
  build_command?: string;
  deploy_command?: string;
  root_directory?: string;
  environment_variables?: Record<string, EnvironmentVariable>;
};

type BuildConfig = {
  git_repository?: {
    provider_type?: string;
    provider_account_name?: string;
    repo_name?: string;
    branch?: string;
  };
  production_settings?: BuildSettings;
  previews_base_config?: BuildSettings;
};

type WorkerBuild = {
  workerName: string;
  workerTag: string;
  branch: string;
  config: BuildConfig;
};

type Build = {
  build_uuid?: string;
  status?: string;
  build_outcome?: string | null;
};

type WorkerDomain = {
  hostname?: string;
  service?: string;
  environment?: string;
};

type Existing = {
  d1Id?: string;
  kvId?: string;
  r2: boolean;
  queue: boolean;
};

type Names = {
  d1: string;
  kv: string;
  r2: string;
  queue: string;
};

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

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

function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

// --- Interaction ----------------------------------------------------------

let prompts: ReturnType<typeof createInterface> | null = null;

function closePrompts(): void {
  prompts?.close();
  prompts = null;
}

async function textLine(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    fail(`${label} 需要在终端中交互输入，或通过命令行参数提供。`);
  }
  prompts ??= createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return (await prompts.question(`${label}：`)).trim();
}

/** Reads a secret without echoing it; the terminal shows one `*` per character. */
async function secretLine(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(`${label} 需要在终端中隐藏输入；请用命令行参数或环境变量提供。`);
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

function printPrerequisites(): void {
  log("开始之前，请先完成三件事：\n");
  log("1. 创建 GitHub OAuth App（用于博客登录）");
  log(`   ${OAUTH_APP_URL}`);
  log("   Homepage URL            https://你的博客域名");
  log(
    "   Authorization callback  https://你的博客域名/api/auth/callback/github",
  );
  log("   创建后复制 Client ID，并生成 Client Secret。\n");
  log("2. 开通 R2，并绑定付款方式");
  log(`   ${R2_URL}`);
  log(
    "   同时把 GitHub 账号连接到 Cloudflare，把你的 fork 连接成 Worker（Workers Builds）：",
  );
  log(`   ${WORKERS_URL}`);
  log(
    "   并确认博客域名已绑定到这个 Worker（脚本会自动读取；没有会再询问）。\n",
  );
  log("3. 准备好你自己名下的 fork 仓库地址，必须以 .git 结尾，例如：");
  log("   https://github.com/你的用户名/flare-stack-blog.git\n");
}

// --- Parsing and validation ----------------------------------------------

function parseRepo(raw: string): Repo {
  const value = trimmed(raw).replace(/\/+$/, "");
  let match = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i.exec(value);
  if (!match) match = /^git@github\.com:([^/]+)\/([^/]+)$/i.exec(value);
  if (!match) match = /^([\w.-]+)\/([\w.-]+)$/.exec(value);
  if (!match) {
    fail(
      `仓库地址「${value}」无法识别。请填 https://github.com/用户名/仓库名.git。`,
    );
  }
  const owner = match[1]!;
  const name = match[2]!.replace(/\.git$/i, "");
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) {
    fail(`仓库地址「${value}」中的用户名或仓库名不合法。`);
  }
  return { owner, name, fullName: `${owner}/${name}`, url: value };
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

function parseCli(): CliValues {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      allowPositionals: false,
      options: {
        repo: { type: "string" },
        email: { type: "string" },
        "api-key": { type: "string" },
        "github-id": { type: "string" },
        "github-secret": { type: "string" },
        account: { type: "string" },
        domain: { type: "string" },
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
  log("请按提示输入。密钥输入时不会显示。\n");

  let repoInput = trimmed(values.repo) || trimmed(process.env.REPO_URL);
  if (!repoInput)
    repoInput = await textLine("GitHub fork 仓库地址（.git 结尾）");
  const repo = parseRepo(repoInput);

  let email = trimmed(values.email) || trimmed(process.env.CLOUDFLARE_EMAIL);
  if (!email) email = await textLine("Cloudflare 账户邮箱");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail(`邮箱「${email}」格式不正确。`);
  }

  let apiKey =
    trimmed(values["api-key"]) || trimmed(process.env.CLOUDFLARE_API_KEY);
  if (!apiKey) apiKey = await secretLine("Cloudflare Global API Key：");

  let githubId =
    trimmed(values["github-id"]) || trimmed(process.env.GITHUB_CLIENT_ID);
  if (!githubId) githubId = await textLine("GitHub OAuth App Client ID");

  let githubSecret =
    trimmed(values["github-secret"]) ||
    trimmed(process.env.GITHUB_CLIENT_SECRET);
  if (!githubSecret)
    githubSecret = await secretLine("GitHub OAuth App Client Secret：");

  const domain =
    trimmed(values.domain) || trimmed(process.env.DOMAIN) || undefined;
  if (domain) validateDomain(domain);

  const accountId =
    trimmed(values.account) || trimmed(process.env.CLOUDFLARE_ACCOUNT_ID);

  return {
    repo,
    email,
    apiKey,
    ...(accountId ? { accountId } : {}),
    githubId,
    githubSecret,
    ...(domain ? { domain } : {}),
  };
}

// --- Cloudflare API -------------------------------------------------------

async function api<T>(
  auth: Auth,
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API + endpoint, {
      method,
      headers: {
        "X-Auth-Email": auth.email,
        "X-Auth-Key": auth.apiKey,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    fail(
      `无法连接 Cloudflare API：${error instanceof Error ? error.message : String(error)}`,
    );
  }

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
    throw new ApiError(
      `Cloudflare API ${method} ${endpoint} 失败（HTTP ${response.status}）${
        messages ? `：${messages}` : ""
      }`,
      response.status,
    );
  }
  return payload.result as T;
}

async function apiOptional<T>(
  auth: Auth,
  method: string,
  endpoint: string,
): Promise<T | null> {
  try {
    return await api<T>(auth, method, endpoint);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
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
    fail("这个 Global API Key 看不到任何 Cloudflare 账户。");
  }
  if (wanted) {
    const found = accounts.find((account) => account.id === wanted);
    if (!found) fail(`账户 id「${wanted}」不在这个密钥的账户列表中。`);
    return found;
  }
  if (accounts.length === 1) return accounts[0]!;
  if (!process.stdin.isTTY) {
    fail(
      `这个密钥可以看到多个账户，需要用 --account 指定其一：\n${accounts
        .map((account) => `  ${account.id}  ${account.name}`)
        .join("\n")}`,
    );
  }
  log("这个密钥可以看到多个账户：");
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

// --- Locating the repo's Worker -------------------------------------------

function repoMatches(config: BuildConfig, repo: Repo): boolean {
  const git = config.git_repository;
  if (!git || (git.provider_type && git.provider_type !== "github")) {
    return false;
  }
  const owner = (git.provider_account_name ?? "").trim().toLowerCase();
  const name = (git.repo_name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "");
  if (owner !== repo.owner.toLowerCase()) return false;
  const expected = repo.name.toLowerCase();
  return name === expected || name === repo.fullName.toLowerCase();
}

async function findWorkerForRepo(
  auth: Auth,
  accountId: string,
  repo: Repo,
): Promise<WorkerBuild> {
  const scripts: Array<Script> = [];
  for (let page = 1; ; page++) {
    const rows = await api<Array<Script>>(
      auth,
      "GET",
      `/accounts/${accountId}/workers/scripts?per_page=100&page=${page}`,
    );
    scripts.push(...rows);
    if (rows.length < 100) break;
  }
  const tagged = scripts.filter((script) => script.tag);
  log(`正在查找监听 ${repo.fullName} 的 Worker（共 ${tagged.length} 个）…`);

  const matches: Array<WorkerBuild> = [];
  for (const script of tagged) {
    const config = await apiOptional<BuildConfig>(
      auth,
      "GET",
      `/accounts/${accountId}/builds/workers/${encodeURIComponent(script.tag!)}`,
    );
    if (!config || !repoMatches(config, repo)) continue;
    matches.push({
      workerName: script.id,
      workerTag: script.tag!,
      branch: config.git_repository?.branch || "main",
      config,
    });
  }

  if (matches.length === 0) {
    fail(
      `没有找到监听 ${repo.fullName} 的 Worker。\n` +
        "请先在 Cloudflare 控制台的 Workers & Pages 中用 GitHub 连接这个仓库（Workers Builds），" +
        "等第一次构建/部署完成后再重新运行本脚本。",
    );
  }
  if (matches.length > 1) {
    fail(
      `有多个 Worker 监听 ${repo.fullName}，无法自动选择：\n` +
        matches.map((match) => `  ${match.workerName}`).join("\n") +
        "\n请只保留一个连接后重试。",
    );
  }
  return matches[0]!;
}

function environmentValue(
  variables: Record<string, EnvironmentVariable> | undefined,
  key: string,
): string | undefined {
  const value = variables?.[key];
  if (typeof value === "string") return value;
  return value?.value;
}

async function resolveDomain(
  auth: Auth,
  accountId: string,
  workerName: string,
  config: BuildConfig,
  override: string | undefined,
): Promise<{ domain: string; note?: string }> {
  if (override) return { domain: override };

  let domains: Array<WorkerDomain> = [];
  try {
    domains = await api<Array<WorkerDomain>>(
      auth,
      "GET",
      `/accounts/${accountId}/workers/domains`,
    );
  } catch {
    // The domain can still come from the build variables below.
  }
  const attached = domains.filter(
    (domain) => domain.service === workerName && domain.hostname,
  );
  const production =
    attached.find((domain) => domain.environment === "production") ??
    attached[0];
  if (production?.hostname) return { domain: production.hostname.trim() };

  const configured = environmentValue(
    config.production_settings?.environment_variables,
    "DOMAIN",
  )?.trim();
  // cloudflare.config.ts turns DOMAIN into a custom domain; a workers.dev
  // hostname there would fail the deploy.
  if (configured && !configured.endsWith(".workers.dev")) {
    return { domain: configured };
  }

  return {
    domain: "",
    note: "未检测到已绑定的域名，请用 --domain 指定或给 Worker 绑定自定义域名",
  };
}

async function findZone(
  auth: Auth,
  accountId: string,
  domain: string,
): Promise<{ id: string; name: string; status: string } | null> {
  let candidate = domain;
  while (candidate.includes(".")) {
    const zones = await api<
      Array<{ id: string; name: string; status: string }>
    >(
      auth,
      "GET",
      `/zones?name=${encodeURIComponent(candidate)}&account.id=${encodeURIComponent(accountId)}&per_page=5`,
    );
    if (zones.length > 0) return zones[0] ?? null;
    const next = candidate.slice(candidate.indexOf(".") + 1);
    if (!next.includes(".")) break;
    candidate = next;
  }
  return null;
}

// --- Resources ------------------------------------------------------------

function resourceName(worker: string, suffix: string): string {
  const base = worker
    .slice(0, Math.max(1, 63 - suffix.length))
    .replace(/-+$/, "");
  return `${base || "blog"}${suffix}`;
}

function resourceNames(worker: string): Names {
  return {
    d1: resourceName(worker, "-db"),
    kv: resourceName(worker, "-kv"),
    r2: resourceName(worker, "-media"),
    queue: resourceName(worker, "-queue"),
  };
}

async function inspectResources(
  auth: Auth,
  accountId: string,
  names: Names,
): Promise<Existing> {
  const [d1Rows, kvRows, r2Result, queueRows] = await Promise.all([
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
  ]);

  return {
    ...(d1Rows.find((row) => row.name === names.d1)?.uuid
      ? { d1Id: d1Rows.find((row) => row.name === names.d1)!.uuid }
      : {}),
    ...(kvRows.find((row) => row.title === names.kv)?.id
      ? { kvId: kvRows.find((row) => row.title === names.kv)!.id }
      : {}),
    r2: (r2Result.buckets ?? []).some((bucket) => bucket.name === names.r2),
    queue: queueRows.some((row) => row.queue_name === names.queue),
  };
}

async function createMissingResources(
  auth: Auth,
  accountId: string,
  names: Names,
  existing: Existing,
): Promise<{ d1Id: string; kvId: string }> {
  let d1Id = existing.d1Id;
  if (d1Id) log(`D1 数据库已存在：${names.d1}（${d1Id}）`);
  else {
    const created = await api<{ uuid: string }>(
      auth,
      "POST",
      `/accounts/${accountId}/d1/database`,
      { name: names.d1 },
    );
    if (!created.uuid) fail("D1 数据库已创建，但响应中没有 UUID。");
    d1Id = created.uuid;
    log(`已创建 D1 数据库：${names.d1}（${d1Id}）`);
  }

  let kvId = existing.kvId;
  if (kvId) log(`KV 命名空间已存在：${names.kv}（${kvId}）`);
  else {
    const created = await api<{ id: string }>(
      auth,
      "POST",
      `/accounts/${accountId}/storage/kv/namespaces`,
      { title: names.kv },
    );
    if (!created.id) fail("KV 命名空间已创建，但响应中没有 id。");
    kvId = created.id;
    log(`已创建 KV 命名空间：${names.kv}（${kvId}）`);
  }

  if (existing.r2) log(`R2 存储桶已存在：${names.r2}`);
  else {
    try {
      await api(auth, "POST", `/accounts/${accountId}/r2/buckets`, {
        name: names.r2,
      });
      log(`已创建 R2 存储桶：${names.r2}`);
    } catch (error) {
      fail(
        `${error instanceof Error ? error.message : String(error)}\nR2 需要先在 Cloudflare 控制台开通（绑定付款方式）后才能创建存储桶。`,
      );
    }
  }

  if (existing.queue) log(`队列已存在：${names.queue}`);
  else {
    await api(auth, "POST", `/accounts/${accountId}/queues`, {
      queue_name: names.queue,
    });
    log(`已创建队列：${names.queue}`);
  }

  return { d1Id, kvId };
}

// --- Workers Builds -------------------------------------------------------

async function updateBuildConfig(
  auth: Auth,
  accountId: string,
  workerTag: string,
  workerName: string,
  domain: string,
  names: Names,
  ids: { d1Id: string; kvId: string },
): Promise<void> {
  const environmentVariables = {
    WORKER_NAME: { value: workerName, is_secret: false },
    DOMAIN: { value: domain, is_secret: false },
    D1_DATABASE_ID: { value: ids.d1Id, is_secret: false },
    KV_NAMESPACE_ID: { value: ids.kvId, is_secret: false },
    BUCKET_NAME: { value: names.r2, is_secret: false },
    QUEUE_NAME: { value: names.queue, is_secret: false },
    BUN_VERSION: { value: "1.3.5", is_secret: false },
  };

  await api(
    auth,
    "PATCH",
    `/accounts/${accountId}/builds/workers/${encodeURIComponent(workerTag)}`,
    {
      production_settings: {
        build_command: "bun run build",
        deploy_command: "bun run deploy",
        root_directory: "/",
        environment_variables: environmentVariables,
      },
    },
  );
  log("已写入构建变量：WORKER_NAME、DOMAIN、D1、KV、R2、Queue");
}

async function startBuild(
  auth: Auth,
  accountId: string,
  workerTag: string,
  branch: string,
): Promise<string> {
  const created = await api<{ build_uuid?: string }>(
    auth,
    "POST",
    `/accounts/${accountId}/builds/workers/${encodeURIComponent(workerTag)}/builds`,
    { branch },
  );
  if (!created.build_uuid) fail("构建已触发，但响应中没有 build_uuid。");
  return created.build_uuid;
}

async function waitForBuild(
  auth: Auth,
  accountId: string,
  buildUuid: string,
  label: string,
): Promise<void> {
  log(`\n${label}已开始（build ${buildUuid}），通常需要几分钟…`);
  let lastStatus = "";
  for (let poll = 1; poll <= BUILD_MAX_POLLS; poll++) {
    const build = await api<Build>(
      auth,
      "GET",
      `/accounts/${accountId}/builds/builds/${buildUuid}`,
    );
    const status = build.status ?? "unknown";
    if (status !== lastStatus) {
      log(`  构建状态：${status}`);
      lastStatus = status;
    }
    if (status === "stopped") {
      const outcome = build.build_outcome ?? "unknown";
      if (outcome === "success") {
        log("  构建成功。");
        return;
      }
      fail(
        `构建失败（${outcome}，build ${buildUuid}）。请在 Cloudflare 控制台的 Deployments / Builds 查看日志。`,
      );
    }
    if (poll < BUILD_MAX_POLLS) await sleep(BUILD_POLL_MS);
  }
  fail(
    `构建在 ${Math.round((BUILD_MAX_POLLS * BUILD_POLL_MS) / 60_000)} 分钟内没有结束（build ${buildUuid}）。请在 Cloudflare 控制台查看进度。`,
  );
}

// --- Runtime secrets ------------------------------------------------------

async function putSecret(
  auth: Auth,
  accountId: string,
  workerName: string,
  name: string,
  text: string,
): Promise<void> {
  await api(
    auth,
    "PUT",
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/secrets`,
    { name, text, type: "secret_text" },
  );
}

async function writeSecrets(
  auth: Auth,
  accountId: string,
  workerName: string,
  domain: string,
  inputs: Inputs,
  existingSecrets: Array<{ name: string }> | null = null,
): Promise<void> {
  const existing =
    existingSecrets ??
    (await api<Array<{ name: string }>>(
      auth,
      "GET",
      `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/secrets`,
    ));
  const names = new Set(existing.map((secret) => secret.name));

  const secrets: Array<[string, string]> = [];
  if (!names.has("BETTER_AUTH_SECRET")) {
    // Rotating this signs everyone out; keep the existing one on reruns.
    secrets.push(["BETTER_AUTH_SECRET", randomHex(32)]);
  } else {
    log("保留现有机密：BETTER_AUTH_SECRET");
  }
  secrets.push(
    ["BETTER_AUTH_URL", `https://${domain}`],
    ["DOMAIN", domain],
    ["ENVIRONMENT", "prod"],
    ["GITHUB_CLIENT_ID", inputs.githubId],
    ["GITHUB_CLIENT_SECRET", inputs.githubSecret],
  );

  for (const [name, value] of secrets) {
    await putSecret(auth, accountId, workerName, name, value);
    log(`已写入机密：${name}`);
  }
}

// --- Verification ---------------------------------------------------------

async function waitForSite(
  url: string,
): Promise<{ ok: boolean; detail: string }> {
  let detail = "";
  for (let attempt = 1; attempt <= SITE_ATTEMPTS; attempt++) {
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
    if (attempt < SITE_ATTEMPTS) await sleep(SITE_INTERVAL_MS);
  }
  return { ok: false, detail };
}

// --- Main -----------------------------------------------------------------

function printSummary(
  inputs: Inputs,
  worker: WorkerBuild,
  names: Names,
  ids: { d1Id: string; kvId: string },
  siteUrl: string,
  verified: { ok: boolean; detail: string },
): void {
  log("\n安装完成");
  log(`  博客地址：${siteUrl}`);
  log(`  Worker：${worker.workerName}`);
  log(`  仓库：${inputs.repo.fullName}（分支 ${worker.branch}）`);
  log(`  D1 数据库：${names.d1}（${ids.d1Id}）`);
  log(`  KV 命名空间：${names.kv}（${ids.kvId}）`);
  log(`  R2 存储桶：${names.r2}`);
  log(`  队列：${names.queue}`);

  if (verified.ok) log(`  访问检查：${verified.detail}`);
  else {
    log(
      `  访问检查：暂时无法访问（${verified.detail}）。域名解析和证书可能需要几分钟。`,
    );
  }

  log("\n请确认 GitHub OAuth App 的回调地址是：");
  log(`  ${siteUrl}/api/auth/callback/github`);
  log("\n第一个通过 GitHub 登录的用户会自动成为管理员。");
  log("之后同步 fork 时，Cloudflare Workers Builds 会继续自动部署。");
}

async function main(): Promise<void> {
  const values = parseCli();
  if (values.help) {
    log(USAGE);
    return;
  }
  if (!(process.versions as unknown as Record<string, string>).bun) {
    fail("此脚本需要用 Bun 运行：bun run setup。");
  }

  printPrerequisites();
  const inputs = await readInputs(values);
  closePrompts();

  const auth: Auth = { email: inputs.email, apiKey: inputs.apiKey };
  const account = await resolveAccount(auth, inputs.accountId);
  log(`\nCloudflare 账户：${account.name}（${account.id}）`);

  const worker = await findWorkerForRepo(auth, account.id, inputs.repo);
  log(`找到 Worker：${worker.workerName}（tag ${worker.workerTag}）`);

  const names = resourceNames(worker.workerName);
  const resolvedDomain = await resolveDomain(
    auth,
    account.id,
    worker.workerName,
    worker.config,
    inputs.domain,
  );
  let domain = resolvedDomain.domain;
  if (!domain && !values["dry-run"]) {
    if (!process.stdin.isTTY) {
      fail(
        "没有检测到博客域名。请给 Worker 绑定自定义域名，或用 --domain 指定。",
      );
    }
    domain = await textLine(
      "没有检测到已绑定的域名，请输入博客域名（例如 blog.example.com）",
    );
    validateDomain(domain);
  }
  if (domain) {
    validateDomain(domain);
    const zone = await findZone(auth, account.id, domain);
    if (!zone) {
      fail(
        `域名「${domain}」不在这个 Cloudflare 账户中。请先把域名接入 Cloudflare，或换一个域名。`,
      );
    }
    if (zone.status !== "active") {
      log(
        `警告：DNS 区域 ${zone.name} 的状态是 ${zone.status}，证书签发可能较晚。`,
      );
    }
  }
  const siteUrl = domain ? `https://${domain}` : resolvedDomain.note!;
  log(`博客地址：${siteUrl}`);

  const existing = await inspectResources(auth, account.id, names);

  if (values["dry-run"]) {
    log("\n安装计划（--dry-run，未做任何修改）");
    log(`  Worker：${worker.workerName}（${worker.branch} 分支）`);
    log(`  博客地址：${siteUrl}`);
    log(
      `  D1：${names.d1}（${existing.d1Id ? `已存在 ${existing.d1Id}` : "将创建"}）`,
    );
    log(
      `  KV：${names.kv}（${existing.kvId ? `已存在 ${existing.kvId}` : "将创建"}）`,
    );
    log(`  R2：${names.r2}（${existing.r2 ? "已存在" : "将创建"}）`);
    log(`  队列：${names.queue}（${existing.queue ? "已存在" : "将创建"}）`);
    log("  之后会写入构建变量和运行时机密，并触发构建（必要时两次）。");
    return;
  }

  const ids = await createMissingResources(auth, account.id, names, existing);

  await updateBuildConfig(
    auth,
    account.id,
    worker.workerTag,
    worker.workerName,
    domain,
    names,
    ids,
  );

  const existingSecrets = await apiOptional<Array<{ name: string }>>(
    auth,
    "GET",
    `/accounts/${account.id}/workers/scripts/${encodeURIComponent(worker.workerName)}/secrets`,
  );

  if (existingSecrets) {
    // The Worker was deployed when the repo was connected; the runtime secrets
    // can be set first, so a single build applies them.
    await writeSecrets(
      auth,
      account.id,
      worker.workerName,
      domain,
      inputs,
      existingSecrets,
    );
    const build = await startBuild(
      auth,
      account.id,
      worker.workerTag,
      worker.branch,
    );
    await waitForBuild(auth, account.id, build, "部署构建");
  } else {
    // No Worker yet: the first build creates it, then secrets and a second
    // build put the secrets into the serving version.
    const firstBuild = await startBuild(
      auth,
      account.id,
      worker.workerTag,
      worker.branch,
    );
    await waitForBuild(auth, account.id, firstBuild, "首次构建");

    await writeSecrets(auth, account.id, worker.workerName, domain, inputs);

    const secondBuild = await startBuild(
      auth,
      account.id,
      worker.workerTag,
      worker.branch,
    );
    await waitForBuild(auth, account.id, secondBuild, "应用机密的构建");
  }

  log(`\n等待 ${siteUrl} 响应…`);
  const verified = await waitForSite(siteUrl);
  printSummary(inputs, worker, names, ids, siteUrl, verified);

  if (!verified.ok) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  closePrompts();
  console.error(
    `\n安装未完成：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
