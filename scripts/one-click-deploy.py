#!/usr/bin/env python3
"""
One-click setup for a Flare Stack Blog that is already connected to
Cloudflare Workers Builds.

Run it in a terminal:

    python3 scripts/one-click-deploy.py

Before asking for credentials the script prints the three things the user has
to prepare: the GitHub OAuth App link, the R2/GitHub binding reminder, and the
.git URL of their own fork. It then asks for the .git URL, the domain the blog
will be served from, the Cloudflare email + Global API Key and the OAuth App's
Client ID/Secret, and runs on its own:

  - finds the Worker whose Workers Builds configuration watches that repo;
  - creates D1, KV, R2 and the queue, named after the Worker;
  - writes the build variables and the runtime secrets;
  - starts a build, and a second one only if the Worker does not exist yet;
  - checks that the site answers.

Only the Python standard library is used. The deployment itself still goes
through Workers Builds, so "Sync fork" keeps deploying exactly as
docs/deployment.md describes.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

API = "https://api.cloudflare.com/client/v4"
OAUTH_APP_URL = "https://github.com/settings/applications/new"
R2_URL = "https://dash.cloudflare.com/?to=/:account/r2"
WORKERS_URL = "https://dash.cloudflare.com/?to=/:account/workers-and-pages"
BUILD_POLL_SECONDS = 15
BUILD_MAX_POLLS = 160
SITE_ATTEMPTS = 24
SITE_INTERVAL_SECONDS = 5
USER_AGENT = "flare-stack-blog-setup/1.0 (python)"

DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$",
    re.IGNORECASE,
)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def fail(message: str) -> None:
    raise RuntimeError(message)


def log(message: str = "") -> None:
    print(message, flush=True)


def _load_json(raw: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _error_messages(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    errors = payload.get("errors")
    if not isinstance(errors, list):
        return ""
    parts: List[str] = []
    for entry in errors:
        if isinstance(entry, dict) and isinstance(entry.get("message"), str):
            parts.append(entry["message"])
        else:
            parts.append(str(entry))
    return "；".join(parts)


def _as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


# --- Interaction ----------------------------------------------------------


def _require_tty(label: str) -> None:
    if not sys.stdin.isatty():
        fail(f"{label}需要在终端中交互输入，或通过命令行参数/环境变量提供。")


def text_line(label: str) -> str:
    _require_tty(label)
    try:
        return input(f"{label}：").strip()
    except EOFError:
        fail(f"没有读取到{label}。")


def secret_line(label: str) -> str:
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        fail(f"{label} 需要在终端中隐藏输入；请用命令行参数或环境变量提供。")
    try:
        return getpass.getpass(f"{label}：").strip()
    except (EOFError, KeyboardInterrupt):
        fail("已取消。")


def print_prerequisites() -> None:
    log("开始之前，请先完成三件事：\n")
    log("1. 创建 GitHub OAuth App（用于博客登录）")
    log(f"   {OAUTH_APP_URL}")
    log("   Homepage URL            https://你的博客域名")
    log("   Authorization callback  https://你的博客域名/api/auth/callback/github")
    log("   创建后复制 Client ID，并生成 Client Secret。\n")
    log("2. 开通 R2，并绑定付款方式")
    log(f"   {R2_URL}")
    log(
        "   同时把 GitHub 账号连接到 Cloudflare，把你的 fork 连接成 Worker（Workers Builds）："
    )
    log(f"   {WORKERS_URL}")
    log("   并确认这个域名已经接入 Cloudflare。\n")
    log("3. 准备好你自己名下的 fork 仓库地址（必须以 .git 结尾）和部署后的域名，例如：")
    log("   https://github.com/你的用户名/flare-stack-blog.git")
    log("   blog.example.com\n")


# --- Parsing and validation ----------------------------------------------


def parse_repo(raw: str) -> Dict[str, str]:
    value = raw.strip().rstrip("/")
    match = re.match(r"^https?://github\.com/([^/]+)/([^/]+)$", value, re.I)
    if not match:
        match = re.match(r"^git@github\.com:([^/]+)/([^/]+)$", value, re.I)
    if not match:
        match = re.match(r"^([\w.-]+)/([\w.-]+)$", value)
    if not match:
        fail(f"仓库地址「{value}」无法识别。请填 https://github.com/用户名/仓库名.git。")
    owner = match.group(1)
    name = re.sub(r"\.git$", "", match.group(2), flags=re.I)
    if not re.fullmatch(r"[\w.-]+", owner) or not re.fullmatch(r"[\w.-]+", name):
        fail(f"仓库地址「{value}」中的用户名或仓库名不合法。")
    return {
        "owner": owner,
        "name": name,
        "fullName": f"{owner}/{name}",
        "url": value,
    }


def validate_domain(domain: str) -> None:
    if not DOMAIN_RE.match(domain):
        fail(f"域名「{domain}」不合法：请填写纯域名，例如 blog.example.com。")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="one-click-deploy.py",
        description=(
            "为已经连接 Cloudflare Workers Builds 的 Flare Stack Blog "
            "一键创建资源、写入构建变量和运行时机密，并通过 Workers Builds 部署。"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "运行前脚本会打印 GitHub OAuth App 链接、R2/GitHub 绑定提醒，"
            "并要求输入你自己 fork 仓库的 .git 地址和部署后的域名。\n\n"
            "示例：\n"
            "  python3 scripts/one-click-deploy.py\n"
            "  python3 scripts/one-click-deploy.py --dry-run\n"
            "  python3 scripts/one-click-deploy.py \\\n"
            "    --repo https://github.com/you/flare-stack-blog.git \\\n"
            "    --domain blog.example.com \\\n"
            "    --email you@example.com --api-key ... \\\n"
            "    --github-id ... --github-secret ..."
        ),
    )
    parser.add_argument(
        "--repo",
        help="GitHub fork 地址，.git 结尾（或环境变量 REPO_URL）",
    )
    parser.add_argument(
        "--email",
        help="Cloudflare 邮箱（或环境变量 CLOUDFLARE_EMAIL）",
    )
    parser.add_argument(
        "--api-key",
        help=(
            "Cloudflare Global API Key（或环境变量 CLOUDFLARE_API_KEY）。"
            "建议交互输入，避免密钥留在 shell 历史中"
        ),
    )
    parser.add_argument(
        "--github-id",
        help="GitHub OAuth App Client ID（或环境变量 GITHUB_CLIENT_ID）",
    )
    parser.add_argument(
        "--github-secret",
        help="GitHub OAuth App Client Secret（或环境变量 GITHUB_CLIENT_SECRET）",
    )
    parser.add_argument(
        "--account",
        help="账户 id，当密钥可见多个账户时（或环境变量 CLOUDFLARE_ACCOUNT_ID）",
    )
    parser.add_argument(
        "--domain",
        help="部署后的博客域名，例如 blog.example.com（或环境变量 DOMAIN）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只读取并打印计划，不做任何修改",
    )
    return parser.parse_args()


def read_inputs(args: argparse.Namespace) -> Dict[str, Any]:
    log("请按提示输入。密钥输入时不会显示。\n")

    repo_raw = (args.repo or os.environ.get("REPO_URL", "")).strip()
    if not repo_raw:
        repo_raw = text_line("GitHub fork 仓库地址（.git 结尾）")
    repo = parse_repo(repo_raw)

    domain = (args.domain or os.environ.get("DOMAIN", "")).strip()
    if not domain:
        domain = text_line("部署后的博客域名（例如 blog.example.com）")
    validate_domain(domain)

    email = (args.email or os.environ.get("CLOUDFLARE_EMAIL", "")).strip()
    if not email:
        email = text_line("Cloudflare 账户邮箱")
    if not EMAIL_RE.match(email):
        fail(f"邮箱「{email}」格式不正确。")

    api_key = (args.api_key or os.environ.get("CLOUDFLARE_API_KEY", "")).strip()
    if not api_key:
        api_key = secret_line("Cloudflare Global API Key")

    github_id = (args.github_id or os.environ.get("GITHUB_CLIENT_ID", "")).strip()
    if not github_id:
        github_id = text_line("GitHub OAuth App Client ID")

    github_secret = (
        args.github_secret or os.environ.get("GITHUB_CLIENT_SECRET", "")
    ).strip()
    if not github_secret:
        github_secret = secret_line("GitHub OAuth App Client Secret")

    account_id = (
        args.account or os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    ).strip()

    return {
        "repo": repo,
        "email": email,
        "apiKey": api_key,
        "accountId": account_id or None,
        "githubId": github_id,
        "githubSecret": github_secret,
        "domain": domain,
    }


# --- Cloudflare API -------------------------------------------------------


def api(
    auth: Dict[str, str],
    method: str,
    endpoint: str,
    body: Optional[Any] = None,
) -> Any:
    url = API + endpoint
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("X-Auth-Email", auth["email"])
    request.add_header("X-Auth-Key", auth["apiKey"])
    request.add_header("User-Agent", USER_AGENT)
    if data is not None:
        request.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        payload = _load_json(raw)
        messages = _error_messages(payload)
        suffix = f"：{messages}" if messages else ""
        raise ApiError(
            error.code,
            f"Cloudflare API {method} {endpoint} 失败（HTTP {error.code}）{suffix}",
        ) from None
    except urllib.error.URLError as error:
        fail(f"无法连接 Cloudflare API：{error.reason}")
    except TimeoutError:
        fail("连接 Cloudflare API 超时。")
    except OSError as error:
        fail(f"无法连接 Cloudflare API：{error}")

    payload = _load_json(raw)
    if not isinstance(payload, dict) or payload.get("success") is not True:
        messages = _error_messages(payload)
        suffix = f"：{messages}" if messages else ""
        raise ApiError(
            200,
            f"Cloudflare API {method} {endpoint} 返回了无法识别的响应{suffix}",
        )
    return payload.get("result")


def api_optional(
    auth: Dict[str, str],
    method: str,
    endpoint: str,
) -> Any:
    try:
        return api(auth, method, endpoint)
    except ApiError as error:
        if error.status == 404:
            return None
        raise


def resolve_account(
    auth: Dict[str, str],
    wanted: Optional[str],
) -> Dict[str, str]:
    accounts = _as_list(api(auth, "GET", "/accounts?per_page=50"))
    if not accounts:
        fail("这个 Global API Key 看不到任何 Cloudflare 账户。")
    if wanted:
        found = next(
            (
                account
                for account in accounts
                if isinstance(account, dict) and account.get("id") == wanted
            ),
            None,
        )
        if not found:
            fail(f"账户 id「{wanted}」不在这个密钥的账户列表中。")
        return found
    if len(accounts) == 1:
        return accounts[0]

    if not sys.stdin.isatty():
        lines = "\n".join(
            f"  {account.get('id')}  {account.get('name')}"
            for account in accounts
            if isinstance(account, dict)
        )
        fail(f"这个密钥可以看到多个账户，需要用 --account 指定其一：\n{lines}")

    log("这个密钥可以看到多个账户：")
    for index, account in enumerate(accounts, start=1):
        log(f"  {index}. {account.get('name')}（{account.get('id')}）")
    answer = text_line(f"选择账户序号（1–{len(accounts)}）")
    try:
        index = int(answer) - 1
    except ValueError:
        fail(f"无效的账户序号：{answer}")
    if index < 0 or index >= len(accounts):
        fail(f"无效的账户序号：{answer}")
    return accounts[index]


# --- Locating the repo's Worker -------------------------------------------


def repo_matches(config: Any, repo: Dict[str, str]) -> bool:
    if not isinstance(config, dict):
        return False
    git = config.get("git_repository")
    if not isinstance(git, dict):
        return False
    provider = git.get("provider_type")
    if provider and provider != "github":
        return False
    owner = str(git.get("provider_account_name") or "").strip().lower()
    name = re.sub(
        r"\.git$",
        "",
        str(git.get("repo_name") or "").strip().lower(),
        flags=re.I,
    )
    if owner != repo["owner"].lower():
        return False
    expected = repo["name"].lower()
    return name == expected or name == repo["fullName"].lower()


def find_worker_for_repo(
    auth: Dict[str, str],
    account_id: str,
    repo: Dict[str, str],
) -> Dict[str, Any]:
    scripts: List[Any] = []
    page = 1
    while page <= 20:
        rows = _as_list(
            api(
                auth,
                "GET",
                f"/accounts/{account_id}/workers/scripts?per_page=100&page={page}",
            )
        )
        scripts.extend(rows)
        if len(rows) < 100:
            break
        page += 1

    tagged = [
        script
        for script in scripts
        if isinstance(script, dict) and script.get("tag")
    ]
    log(f"正在查找监听 {repo['fullName']} 的 Worker（共 {len(tagged)} 个）…")

    matches: List[Dict[str, Any]] = []
    for script in tagged:
        tag = str(script["tag"])
        config = api_optional(
            auth,
            "GET",
            f"/accounts/{account_id}/builds/workers/{urllib.parse.quote(tag, safe='')}",
        )
        if not config or not repo_matches(config, repo):
            continue
        git = config.get("git_repository") or {}
        matches.append(
            {
                "workerName": str(script.get("id") or ""),
                "workerTag": tag,
                "branch": str(git.get("branch") or "main"),
                "config": config,
            }
        )

    if not matches:
        fail(
            f"没有找到监听 {repo['fullName']} 的 Worker。\n"
            "请先在 Cloudflare 控制台的 Workers & Pages 中用 GitHub 连接这个仓库"
            "（Workers Builds），等第一次构建/部署完成后再重新运行本脚本。"
        )
    if len(matches) > 1:
        names = "\n".join(f"  {match['workerName']}" for match in matches)
        fail(
            f"有多个 Worker 监听 {repo['fullName']}，无法自动选择：\n{names}\n"
            "请只保留一个连接后重试。"
        )
    return matches[0]


def find_zone(
    auth: Dict[str, str],
    account_id: str,
    domain: str,
) -> Optional[Dict[str, Any]]:
    candidate = domain
    while "." in candidate:
        query = urllib.parse.urlencode(
            {"name": candidate, "account.id": account_id, "per_page": 5}
        )
        zones = _as_list(api(auth, "GET", f"/zones?{query}"))
        if zones:
            return zones[0]
        next_candidate = candidate.split(".", 1)[1]
        if "." not in next_candidate:
            break
        candidate = next_candidate
    return None


# --- Resources ------------------------------------------------------------


def resource_name(worker: str, suffix: str) -> str:
    base = worker[: max(1, 63 - len(suffix))].rstrip("-")
    return f"{base or 'blog'}{suffix}"


def resource_names(worker: str) -> Dict[str, str]:
    return {
        "d1": resource_name(worker, "-db"),
        "kv": resource_name(worker, "-kv"),
        "r2": resource_name(worker, "-media"),
        "queue": resource_name(worker, "-queue"),
    }


def inspect_resources(
    auth: Dict[str, str],
    account_id: str,
    names: Dict[str, str],
) -> Dict[str, Any]:
    d1_rows = _as_list(
        api(auth, "GET", f"/accounts/{account_id}/d1/database?per_page=100")
    )
    kv_rows = _as_list(
        api(
            auth,
            "GET",
            f"/accounts/{account_id}/storage/kv/namespaces?per_page=1000",
        )
    )
    r2_result = api(auth, "GET", f"/accounts/{account_id}/r2/buckets?per_page=100")
    queue_rows = _as_list(
        api(auth, "GET", f"/accounts/{account_id}/queues?per_page=100")
    )

    buckets = (
        _as_list(r2_result.get("buckets"))
        if isinstance(r2_result, dict)
        else []
    )

    d1_id = next(
        (
            str(row["uuid"])
            for row in d1_rows
            if isinstance(row, dict)
            and row.get("name") == names["d1"]
            and row.get("uuid")
        ),
        None,
    )
    kv_id = next(
        (
            str(row["id"])
            for row in kv_rows
            if isinstance(row, dict)
            and row.get("title") == names["kv"]
            and row.get("id")
        ),
        None,
    )
    r2_exists = any(
        isinstance(bucket, dict) and bucket.get("name") == names["r2"]
        for bucket in buckets
    )
    queue_exists = any(
        isinstance(row, dict) and row.get("queue_name") == names["queue"]
        for row in queue_rows
    )
    return {"d1Id": d1_id, "kvId": kv_id, "r2": r2_exists, "queue": queue_exists}


def create_missing_resources(
    auth: Dict[str, str],
    account_id: str,
    names: Dict[str, str],
    existing: Dict[str, Any],
) -> Dict[str, str]:
    d1_id = existing.get("d1Id")
    if d1_id:
        log(f"D1 数据库已存在：{names['d1']}（{d1_id}）")
    else:
        created = api(
            auth,
            "POST",
            f"/accounts/{account_id}/d1/database",
            {"name": names["d1"]},
        )
        d1_id = created.get("uuid") if isinstance(created, dict) else None
        if not d1_id:
            fail("D1 数据库已创建，但响应中没有 UUID。")
        log(f"已创建 D1 数据库：{names['d1']}（{d1_id}）")

    kv_id = existing.get("kvId")
    if kv_id:
        log(f"KV 命名空间已存在：{names['kv']}（{kv_id}）")
    else:
        created = api(
            auth,
            "POST",
            f"/accounts/{account_id}/storage/kv/namespaces",
            {"title": names["kv"]},
        )
        kv_id = created.get("id") if isinstance(created, dict) else None
        if not kv_id:
            fail("KV 命名空间已创建，但响应中没有 id。")
        log(f"已创建 KV 命名空间：{names['kv']}（{kv_id}）")

    if existing.get("r2"):
        log(f"R2 存储桶已存在：{names['r2']}")
    else:
        try:
            api(
                auth,
                "POST",
                f"/accounts/{account_id}/r2/buckets",
                {"name": names["r2"]},
            )
            log(f"已创建 R2 存储桶：{names['r2']}")
        except ApiError as error:
            fail(
                f"{error}\n"
                "R2 需要先在 Cloudflare 控制台开通（绑定付款方式）后才能创建存储桶。"
            )

    if existing.get("queue"):
        log(f"队列已存在：{names['queue']}")
    else:
        api(
            auth,
            "POST",
            f"/accounts/{account_id}/queues",
            {"queue_name": names["queue"]},
        )
        log(f"已创建队列：{names['queue']}")

    return {"d1Id": str(d1_id), "kvId": str(kv_id)}


# --- Workers Builds -------------------------------------------------------


def update_build_config(
    auth: Dict[str, str],
    account_id: str,
    worker_tag: str,
    worker_name: str,
    domain: str,
    names: Dict[str, str],
    ids: Dict[str, str],
) -> None:
    body = {
        "production_settings": {
            "build_command": "bun run build",
            "deploy_command": "bun run deploy",
            "root_directory": "/",
            "environment_variables": {
                "WORKER_NAME": {"value": worker_name, "is_secret": False},
                "DOMAIN": {"value": domain, "is_secret": False},
                "D1_DATABASE_ID": {"value": ids["d1Id"], "is_secret": False},
                "KV_NAMESPACE_ID": {"value": ids["kvId"], "is_secret": False},
                "BUCKET_NAME": {"value": names["r2"], "is_secret": False},
                "QUEUE_NAME": {"value": names["queue"], "is_secret": False},
                "BUN_VERSION": {"value": "1.3.5", "is_secret": False},
            },
        }
    }
    api(
        auth,
        "PATCH",
        f"/accounts/{account_id}/builds/workers/{urllib.parse.quote(worker_tag, safe='')}",
        body,
    )
    log("已写入构建变量：WORKER_NAME、DOMAIN、D1、KV、R2、Queue")


def start_build(
    auth: Dict[str, str],
    account_id: str,
    worker_tag: str,
    branch: str,
) -> str:
    created = api(
        auth,
        "POST",
        f"/accounts/{account_id}/builds/workers/{urllib.parse.quote(worker_tag, safe='')}/builds",
        {"branch": branch},
    )
    build_uuid = created.get("build_uuid") if isinstance(created, dict) else None
    if not build_uuid:
        fail("构建已触发，但响应中没有 build_uuid。")
    return str(build_uuid)


def wait_for_build(
    auth: Dict[str, str],
    account_id: str,
    build_uuid: str,
    label: str,
) -> None:
    log(f"\n{label}已开始（build {build_uuid}），通常需要几分钟…")
    last_status = ""
    for poll in range(1, BUILD_MAX_POLLS + 1):
        build = api(
            auth,
            "GET",
            f"/accounts/{account_id}/builds/builds/{urllib.parse.quote(build_uuid, safe='')}",
        )
        if not isinstance(build, dict):
            fail(f"构建状态响应无法识别（build {build_uuid}）。")
        status = str(build.get("status") or "unknown")
        if status != last_status:
            log(f"  构建状态：{status}")
            last_status = status
        if status == "stopped":
            outcome = str(build.get("build_outcome") or "unknown")
            if outcome == "success":
                log("  构建成功。")
                return
            fail(
                f"构建失败（{outcome}，build {build_uuid}）。"
                "请在 Cloudflare 控制台的 Deployments / Builds 查看日志。"
            )
        if poll < BUILD_MAX_POLLS:
            time.sleep(BUILD_POLL_SECONDS)
    fail(
        f"构建在 {round((BUILD_MAX_POLLS * BUILD_POLL_SECONDS) / 60)} 分钟内没有结束"
        f"（build {build_uuid}）。请在 Cloudflare 控制台查看进度。"
    )


# --- Runtime secrets ------------------------------------------------------


def put_secret(
    auth: Dict[str, str],
    account_id: str,
    worker_name: str,
    name: str,
    text: str,
) -> None:
    api(
        auth,
        "PUT",
        f"/accounts/{account_id}/workers/scripts/{urllib.parse.quote(worker_name, safe='')}/secrets",
        {"name": name, "text": text, "type": "secret_text"},
    )


def write_secrets(
    auth: Dict[str, str],
    account_id: str,
    worker_name: str,
    domain: str,
    inputs: Dict[str, Any],
    existing_secrets: Optional[List[Any]] = None,
) -> None:
    if existing_secrets is None:
        existing_secrets = _as_list(
            api(
                auth,
                "GET",
                f"/accounts/{account_id}/workers/scripts/{urllib.parse.quote(worker_name, safe='')}/secrets",
            )
        )
    names = {
        str(secret.get("name"))
        for secret in existing_secrets
        if isinstance(secret, dict) and secret.get("name")
    }

    secrets_to_write: List[Tuple[str, str]] = []
    if "BETTER_AUTH_SECRET" not in names:
        # Rotating this signs everyone out; keep the existing one on reruns.
        secrets_to_write.append(("BETTER_AUTH_SECRET", secrets.token_hex(32)))
    else:
        log("保留现有机密：BETTER_AUTH_SECRET")
    secrets_to_write.extend(
        [
            ("BETTER_AUTH_URL", f"https://{domain}"),
            ("DOMAIN", domain),
            ("ENVIRONMENT", "prod"),
            ("GITHUB_CLIENT_ID", inputs["githubId"]),
            ("GITHUB_CLIENT_SECRET", inputs["githubSecret"]),
        ]
    )

    for name, value in secrets_to_write:
        put_secret(auth, account_id, worker_name, name, value)
        log(f"已写入机密：{name}")


# --- Verification ---------------------------------------------------------


def wait_for_site(url: str) -> Tuple[bool, str]:
    detail = ""
    for attempt in range(1, SITE_ATTEMPTS + 1):
        request = urllib.request.Request(
            url,
            method="GET",
            headers={"User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                status = getattr(response, "status", 200)
                if 200 <= status < 400:
                    return True, f"HTTP {status}"
                detail = f"HTTP {status}"
        except urllib.error.HTTPError as error:
            if 200 <= error.code < 400:
                return True, f"HTTP {error.code}"
            detail = f"HTTP {error.code}"
        except urllib.error.URLError as error:
            detail = str(error.reason)
        except Exception as error:
            detail = str(error)
        if attempt < SITE_ATTEMPTS:
            time.sleep(SITE_INTERVAL_SECONDS)
    return False, detail


# --- Main -----------------------------------------------------------------


def print_summary(
    inputs: Dict[str, Any],
    worker: Dict[str, Any],
    names: Dict[str, str],
    ids: Dict[str, str],
    site_url: str,
    verified: Tuple[bool, str],
) -> None:
    log("\n安装完成")
    log(f"  博客地址：{site_url}")
    log(f"  Worker：{worker['workerName']}")
    log(f"  仓库：{inputs['repo']['fullName']}（分支 {worker['branch']}）")
    log(f"  D1 数据库：{names['d1']}（{ids['d1Id']}）")
    log(f"  KV 命名空间：{names['kv']}（{ids['kvId']}）")
    log(f"  R2 存储桶：{names['r2']}")
    log(f"  队列：{names['queue']}")

    if verified[0]:
        log(f"  访问检查：{verified[1]}")
    else:
        log(
            f"  访问检查：暂时无法访问（{verified[1]}）。"
            "域名解析和证书可能需要几分钟。"
        )

    log("\n请确认 GitHub OAuth App 的回调地址是：")
    log(f"  {site_url}/api/auth/callback/github")
    log("\n第一个通过 GitHub 登录的用户会自动成为管理员。")
    log("之后同步 fork 时，Cloudflare Workers Builds 会继续自动部署。")


def main() -> int:
    if sys.version_info < (3, 8):
        fail("此脚本需要 Python 3.8 或更高版本。")

    args = parse_args()
    print_prerequisites()
    inputs = read_inputs(args)

    auth = {"email": inputs["email"], "apiKey": inputs["apiKey"]}
    account = resolve_account(auth, inputs["accountId"])
    log(f"\nCloudflare 账户：{account.get('name')}（{account.get('id')}）")

    account_id = str(account["id"])
    worker = find_worker_for_repo(auth, account_id, inputs["repo"])
    log(f"找到 Worker：{worker['workerName']}（tag {worker['workerTag']}）")

    names = resource_names(worker["workerName"])
    domain = str(inputs["domain"])
    validate_domain(domain)
    zone = find_zone(auth, account_id, domain)
    if not zone:
        fail(
            f"域名「{domain}」不在这个 Cloudflare 账户中。"
            "请先把域名接入 Cloudflare，或换一个域名。"
        )
    if zone.get("status") != "active":
        log(
            f"警告：DNS 区域 {zone.get('name')} 的状态是 {zone.get('status')}，"
            "证书签发可能较晚。"
        )

    site_url = f"https://{domain}"
    log(f"博客地址：{site_url}")

    existing = inspect_resources(auth, account_id, names)

    if args.dry_run:
        log("\n安装计划（--dry-run，未做任何修改）")
        log(f"  Worker：{worker['workerName']}（{worker['branch']} 分支）")
        log(f"  博客地址：{site_url}")
        log(
            f"  D1：{names['d1']}（"
            f"{'已存在 ' + existing['d1Id'] if existing['d1Id'] else '将创建'}）"
        )
        log(
            f"  KV：{names['kv']}（"
            f"{'已存在 ' + existing['kvId'] if existing['kvId'] else '将创建'}）"
        )
        log(f"  R2：{names['r2']}（{'已存在' if existing['r2'] else '将创建'}）")
        log(f"  队列：{names['queue']}（{'已存在' if existing['queue'] else '将创建'}）")
        log("  之后会写入构建变量和运行时机密，并触发构建（必要时两次）。")
        return 0

    ids = create_missing_resources(auth, account_id, names, existing)

    update_build_config(
        auth,
        account_id,
        worker["workerTag"],
        worker["workerName"],
        domain,
        names,
        ids,
    )

    script_path = (
        f"/accounts/{account_id}/workers/scripts/"
        f"{urllib.parse.quote(worker['workerName'], safe='')}/secrets"
    )
    existing_secrets = api_optional(auth, "GET", script_path)

    if existing_secrets is not None:
        # The Worker was deployed when the repo was connected; the runtime
        # secrets can be set first, so a single build applies them.
        write_secrets(
            auth,
            account_id,
            worker["workerName"],
            domain,
            inputs,
            _as_list(existing_secrets),
        )
        build = start_build(
            auth,
            account_id,
            worker["workerTag"],
            worker["branch"],
        )
        wait_for_build(auth, account_id, build, "部署构建")
    else:
        # No Worker yet: the first build creates it, then secrets and a second
        # build put the secrets into the serving version.
        first_build = start_build(
            auth,
            account_id,
            worker["workerTag"],
            worker["branch"],
        )
        wait_for_build(auth, account_id, first_build, "首次构建")

        write_secrets(
            auth,
            account_id,
            worker["workerName"],
            domain,
            inputs,
        )

        second_build = start_build(
            auth,
            account_id,
            worker["workerTag"],
            worker["branch"],
        )
        wait_for_build(auth, account_id, second_build, "应用机密的构建")

    log(f"\n等待 {site_url} 响应…")
    verified = wait_for_site(site_url)
    print_summary(inputs, worker, names, ids, site_url, verified)

    return 0 if verified[0] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n已取消。", file=sys.stderr)
        sys.exit(130)
    except Exception as error:
        print(f"\n安装未完成：{error}", file=sys.stderr)
        sys.exit(1)
