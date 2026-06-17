import logging
import os
import re
import secrets
import shutil
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Optional

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import maildir

log = logging.getLogger("mail-admin")

ROOT_DOMAIN = os.getenv("ROOT_DOMAIN", "wyzai.top").lower().strip()
DATABASE_URL = os.getenv("DATABASE_URL", "")
ADMIN_API_TOKEN = os.getenv("ADMIN_API_TOKEN", "")
MAIL_HOSTNAME = os.getenv("MAIL_HOSTNAME", f"mx1.{ROOT_DOMAIN}")

CF_API_TOKEN = os.getenv("CF_API_TOKEN", "")
CF_ZONE_ID = os.getenv("CF_ZONE_ID", "")

# Multi-root support is now persisted in the `root_domains` table and managed
# through the web UI / API. The ROOT_DOMAINS env var is only used ONCE, to seed
# an empty table on first boot (smooth migration). Format:
#   "root1:zoneid1[:token1],root2:zoneid2[:token2],..."
# token is optional; if omitted, falls back to CF_API_TOKEN.
_ROOT_DOMAINS_RAW = os.getenv("ROOT_DOMAINS", "").strip()

VMAIL_ROOT = Path(os.getenv("VMAIL_ROOT", "/var/vmail"))

TENANT_RE = re.compile(r"^[a-z0-9-]+$")
LOCAL_PART_RE = re.compile(r"^[a-z0-9._-]+$")
ROOT_DOMAIN_RE = re.compile(r"^[a-z0-9.-]+\.[a-z]{2,}$")


def _parse_env_root_domains() -> dict[str, dict[str, str]]:
    """Parse the ROOT_DOMAINS env var (seed source / pre-DB fallback)."""
    out: dict[str, dict[str, str]] = {}
    if _ROOT_DOMAINS_RAW:
        for chunk in _ROOT_DOMAINS_RAW.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            parts = chunk.split(":")
            root = parts[0].strip().lower()
            zone = parts[1].strip() if len(parts) > 1 else ""
            tok = parts[2].strip() if len(parts) > 2 else CF_API_TOKEN
            if root:
                out[root] = {"zone_id": zone, "token": tok, "label": "", "is_default": not out}
    if not out:
        out[ROOT_DOMAIN] = {"zone_id": CF_ZONE_ID, "token": CF_API_TOKEN, "label": "", "is_default": True}
    return out


# ---------------------------------------------------------------------------
# Root domains: DB-backed, hot-reloaded with a short TTL cache
# ---------------------------------------------------------------------------

_ROOTS_TTL = 5.0
_roots_lock = threading.Lock()
_roots_cache: dict[str, dict] = {}
_roots_cache_ts: float = 0.0


def _ensure_root_table() -> None:
    assert pool is not None
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS root_domains (
                root_domain TEXT PRIMARY KEY CHECK (root_domain ~ '^[a-z0-9.-]+$'),
                zone_id     TEXT NOT NULL DEFAULT '',
                cf_token    TEXT NOT NULL DEFAULT '',
                label       TEXT NOT NULL DEFAULT '',
                is_default  BOOLEAN NOT NULL DEFAULT FALSE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        # at most one default
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS root_domains_one_default "
            "ON root_domains ((is_default)) WHERE is_default"
        )


def _seed_roots_from_env() -> None:
    """Populate root_domains from the env var, but only if the table is empty."""
    assert pool is not None
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM root_domains")
        if (cur.fetchone() or [0])[0] > 0:
            return
        seed = _parse_env_root_domains()
        for root, cfg in seed.items():
            cur.execute(
                "INSERT INTO root_domains (root_domain, zone_id, cf_token, label, is_default) "
                "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (root_domain) DO NOTHING",
                (root, cfg.get("zone_id", ""), cfg.get("token", ""),
                 cfg.get("label", "") or "env-seed", bool(cfg.get("is_default"))),
            )
        log.info("Seeded %d root domain(s) from ROOT_DOMAINS env", len(seed))


def _load_roots(force: bool = False) -> dict[str, dict]:
    """Return {root: {zone_id, token, label, is_default, created_at}} (insertion-ordered, default first)."""
    global _roots_cache, _roots_cache_ts
    now = time.monotonic()
    if not force and _roots_cache and (now - _roots_cache_ts) < _ROOTS_TTL:
        return _roots_cache
    out: dict[str, dict] = {}
    if pool is not None:
        try:
            with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    "SELECT root_domain, zone_id, cf_token, label, is_default, created_at "
                    "FROM root_domains ORDER BY is_default DESC, root_domain"
                )
                for r in cur.fetchall():
                    out[r["root_domain"]] = {
                        "zone_id": r["zone_id"] or "",
                        "token": r["cf_token"] or CF_API_TOKEN,
                        "raw_token": r["cf_token"] or "",
                        "label": r["label"] or "",
                        "is_default": bool(r["is_default"]),
                        "created_at": r["created_at"],
                    }
        except Exception as e:  # pragma: no cover - table may not exist yet
            log.warning("root_domains load failed, using env fallback: %s", e)
    if not out:
        out = _parse_env_root_domains()
    with _roots_lock:
        _roots_cache = out
        _roots_cache_ts = now
    return out


def _default_root() -> str:
    roots = _load_roots()
    for root, cfg in roots.items():
        if cfg.get("is_default"):
            return root
    return next(iter(roots)) if roots else ROOT_DOMAIN


def _domain_re() -> re.Pattern:
    roots = _load_roots()
    group = "|".join(re.escape(r) for r in roots) or re.escape(ROOT_DOMAIN)
    return re.compile(rf"^mail\.[a-z0-9-]+\.(?:{group})$")


def _mask_token(tok: str) -> str:
    if not tok:
        return ""
    return f"****{tok[-4:]}" if len(tok) > 4 else "****"

_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"  # no confusing chars


pool: Optional[ConnectionPool] = None


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class DomainCreate(BaseModel):
    tenant_slug: Optional[str] = Field(default=None, min_length=1, max_length=63, description="Lowercase slug; omit with random=true to auto-generate")
    random: bool = Field(default=False, description="Auto-generate tenant_slug if true")
    root_domain: Optional[str] = Field(default=None, description="Root domain to use; must be in ROOT_DOMAINS. Defaults to first configured root.")


class MailboxCreate(BaseModel):
    domain: str = Field(min_length=3, max_length=255)
    local_part: Optional[str] = Field(default=None, min_length=1, max_length=64)
    password: Optional[str] = Field(default=None, min_length=8, max_length=256)
    quota_mb: int = Field(default=1024, ge=1, le=102400)
    random: bool = Field(default=False, description="Auto-generate local_part & password if not provided")


class MailboxOut(BaseModel):
    mailbox_id: int
    email: str
    password: Optional[str] = None  # only present when auto-generated


class MailboxBatchCreate(BaseModel):
    domain: Optional[str] = Field(default=None, description="Existing domain; if omitted and new_domain=true, a new random domain is created")
    count: int = Field(ge=1, le=100)
    quota_mb: int = Field(default=1024, ge=1, le=102400)
    new_domain: bool = Field(default=False, description="Create a random new domain for this batch")
    root_domain: Optional[str] = Field(default=None, description="Root domain when new_domain=true; defaults to first configured root.")


class PasswordReset(BaseModel):
    password: str = Field(min_length=8, max_length=256)


class RootDomainCreate(BaseModel):
    root_domain: str = Field(min_length=3, max_length=253, description="e.g. example.com")
    zone_id: str = Field(min_length=1, max_length=64, description="Cloudflare Zone ID")
    cf_token: Optional[str] = Field(default=None, description="CF API token; empty falls back to global CF_API_TOKEN")
    label: str = Field(default="", max_length=64, description="Optional note, e.g. 'CF #2'")
    set_default: bool = Field(default=False)
    verify: bool = Field(default=True, description="Verify token+zone against Cloudflare before saving")


class RootDomainUpdate(BaseModel):
    zone_id: Optional[str] = Field(default=None, max_length=64)
    cf_token: Optional[str] = Field(default=None, description="New token; omit/empty keeps existing")
    label: Optional[str] = Field(default=None, max_length=64)
    set_default: Optional[bool] = Field(default=None)
    verify: bool = Field(default=False)


class RootDomainVerify(BaseModel):
    zone_id: str = Field(min_length=1, max_length=64)
    cf_token: Optional[str] = Field(default=None)


class CfZonesRequest(BaseModel):
    cf_token: Optional[str] = Field(default=None, description="CF API token; empty falls back to global CF_API_TOKEN")


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(_: FastAPI):
    global pool
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required")

    pool = ConnectionPool(conninfo=DATABASE_URL, min_size=1, max_size=20, kwargs={"autocommit": True})
    try:
        _ensure_root_table()
        _seed_roots_from_env()
        _load_roots(force=True)
    except Exception as e:  # pragma: no cover - boot resilience
        log.warning("root_domains init failed (continuing): %s", e)
    yield
    if pool is not None:
        pool.close()


app = FastAPI(
    title="Mail Admin API",
    version="1.1.0",
    summary="Programmatic management of the self-hosted mailbox pool.",
    description=(
        "API-first control plane for the Postfix + Dovecot + PostgreSQL mail stack. "
        "Create/delete domains & mailboxes, read IMAP inboxes directly from Maildir, "
        "and extract the latest verification code. Intended for automation."
    ),
    lifespan=lifespan,
    openapi_tags=[
        {"name": "Auth", "description": "Token validation"},
        {"name": "Domains", "description": "Tenant domains (mail.<slug>.<root>)"},
        {"name": "Mailboxes", "description": "Virtual mailboxes (local_part@domain)"},
        {"name": "Messages", "description": "Read inbox and extract verification codes"},
        {"name": "Stats", "description": "Pool statistics"},
        {"name": "Meta", "description": "Health, OpenAPI"},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def require_auth(authorization: Annotated[Optional[str], Header()] = None) -> None:
    if not ADMIN_API_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ADMIN_API_TOKEN is not configured",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization[7:]
    if token != ADMIN_API_TOKEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def _normalize_domain(domain: str) -> str:
    value = domain.strip().lower()
    if not _domain_re().fullmatch(value):
        roots = " | ".join(_load_roots())
        raise HTTPException(status_code=422, detail=f"domain must match: mail.<tenant>.<root>  (root in: {roots})")
    return value


def _resolve_root(domain: str) -> Optional[str]:
    """Given mail.<slug>.<root>, return the matching root if configured."""
    for root in _load_roots():
        if domain.endswith("." + root):
            return root
    return None


def _pick_root(requested: Optional[str]) -> str:
    roots = _load_roots()
    if not requested:
        return _default_root()
    value = requested.strip().lower()
    if value not in roots:
        raise HTTPException(status_code=422, detail=f"unknown root_domain '{value}'. Available: {', '.join(roots)}")
    return value


def _split_email(email: str) -> tuple[str, str]:
    value = email.strip().lower()
    if "@" not in value:
        raise HTTPException(status_code=422, detail="Invalid email")
    local_part, domain = value.split("@", 1)
    if not LOCAL_PART_RE.fullmatch(local_part):
        raise HTTPException(status_code=422, detail="Invalid local part")
    domain = _normalize_domain(domain)
    return local_part, domain


def _rand(length: int, alphabet: str = _ALPHABET) -> str:
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _gen_slug() -> str:
    return _rand(4, "abcdefghijkmnpqrstuvwxyz") + _rand(3, "23456789")


def _gen_local_part() -> str:
    return _rand(6, "abcdefghijkmnpqrstuvwxyz") + _rand(4, "23456789")


def _gen_password() -> str:
    # 16 chars, ensures at least one upper/digit/symbol — simple but strong
    base = _rand(12)
    return base + secrets.choice("ABCDEFGHJKMNPQRSTUVWXYZ") + secrets.choice("23456789") + secrets.choice("!@#$%&*") + secrets.choice("abcdefghijkmnpqrstuvwxyz")


# ---------------------------------------------------------------------------
# Cloudflare helpers
# ---------------------------------------------------------------------------


def _cf_creds_for(domain: str) -> tuple[str, str]:
    """Return (token, zone_id) for the root that owns this domain. Empty strings if unconfigured."""
    root = _resolve_root(domain)
    if root is None:
        return "", ""
    cfg = _load_roots().get(root, {})
    return cfg.get("token", "") or CF_API_TOKEN, cfg.get("zone_id", "")


def _cf_verify(token: str, zone_id: str) -> dict:
    """Verify a CF token + zone_id pair by reading the zone. Returns {ok, zone_name|errors}."""
    if not token or not zone_id:
        return {"ok": False, "detail": "token and zone_id are required"}
    try:
        resp = httpx.get(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}",
            headers=_cf_headers(token), timeout=10,
        )
        data = resp.json()
        if data.get("success") and data.get("result"):
            return {"ok": True, "zone_name": data["result"].get("name", "")}
        return {"ok": False, "errors": data.get("errors", [])}
    except Exception as e:  # pragma: no cover - network
        return {"ok": False, "detail": str(e)}


def _cf_list_zones(token: str) -> dict:
    """List every zone the token can access. Returns {ok, zones:[{zone_id,name,status}]}."""
    if not token:
        return {"ok": False, "detail": "no CF token provided and global CF_API_TOKEN is empty"}
    zones: list[dict] = []
    try:
        page = 1
        while True:
            resp = httpx.get(
                "https://api.cloudflare.com/client/v4/zones",
                headers=_cf_headers(token),
                params={"per_page": 50, "page": page},
                timeout=10,
            )
            data = resp.json()
            if not data.get("success"):
                return {"ok": False, "errors": data.get("errors", [])}
            for z in data.get("result", []):
                zones.append({"zone_id": z.get("id", ""), "name": z.get("name", ""), "status": z.get("status", "")})
            info = data.get("result_info") or {}
            if page >= (info.get("total_pages") or 1) or not data.get("result"):
                break
            page += 1
        zones.sort(key=lambda z: z["name"])
        return {"ok": True, "zones": zones, "count": len(zones)}
    except Exception as e:  # pragma: no cover - network
        return {"ok": False, "detail": str(e)}


def _cf_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _cf_url(zone_id: str) -> str:
    return f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"


def _ensure_dns_mx(domain: str) -> dict:
    token, zone_id = _cf_creds_for(domain)
    if not token or not zone_id:
        return {"status": "skipped", "reason": "CF token or zone_id not set for this root"}
    try:
        resp = httpx.get(_cf_url(zone_id), headers=_cf_headers(token), params={"type": "MX", "name": domain}, timeout=10)
        data = resp.json()
        if data.get("success") and data.get("result"):
            return {"status": "exists", "record_id": data["result"][0]["id"]}
        resp = httpx.post(
            _cf_url(zone_id),
            headers=_cf_headers(token),
            json={"type": "MX", "name": domain, "content": MAIL_HOSTNAME, "priority": 10, "ttl": 1},
            timeout=10,
        )
        data = resp.json()
        if data.get("success"):
            return {"status": "created", "record_id": data["result"]["id"]}
        return {"status": "error", "errors": data.get("errors", [])}
    except Exception as e:  # pragma: no cover - network
        log.warning("Cloudflare DNS create error: %s", e)
        return {"status": "error", "detail": str(e)}


def _delete_dns_mx(domain: str) -> dict:
    token, zone_id = _cf_creds_for(domain)
    if not token or not zone_id:
        return {"status": "skipped"}
    try:
        resp = httpx.get(_cf_url(zone_id), headers=_cf_headers(token), params={"type": "MX", "name": domain}, timeout=10)
        data = resp.json()
        if not (data.get("success") and data.get("result")):
            return {"status": "not_found"}
        deleted = []
        for rec in data["result"]:
            rid = rec["id"]
            d = httpx.delete(f"{_cf_url(zone_id)}/{rid}", headers=_cf_headers(token), timeout=10).json()
            if d.get("success"):
                deleted.append(rid)
        return {"status": "deleted", "record_ids": deleted}
    except Exception as e:  # pragma: no cover
        log.warning("Cloudflare DNS delete error: %s", e)
        return {"status": "error", "detail": str(e)}


# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------


@app.get("/health", tags=["Meta"])
def health() -> dict:
    return {"status": "ok"}


@app.get("/v1/auth/verify", tags=["Auth"], dependencies=[Depends(require_auth)])
def verify_token() -> dict:
    return {"ok": True}


def _count_domains_per_root() -> dict[str, int]:
    """Map each configured root -> number of tenant sub-domains under it."""
    roots = list(_load_roots().keys())
    counts = {r: 0 for r in roots}
    if pool is None or not roots:
        return counts
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT domain FROM domains")
        for row in cur.fetchall():
            dom = row["domain"]
            for r in roots:
                if dom.endswith("." + r):
                    counts[r] += 1
                    break
    return counts


@app.get("/v1/root-domains", tags=["Domains"], dependencies=[Depends(require_auth)])
def list_root_domains() -> dict:
    """List configured root domains. Tokens are masked. Includes per-root sub-domain counts."""
    roots = _load_roots()
    default = _default_root()
    counts = _count_domains_per_root()
    items = []
    for root, cfg in roots.items():
        raw = cfg.get("raw_token", "")
        items.append({
            "root_domain": root,
            "zone_id": cfg.get("zone_id", ""),
            "token_masked": _mask_token(raw or (CF_API_TOKEN if cfg.get("token") else "")),
            "has_token": bool(cfg.get("token")),
            "uses_global_token": (not raw) and bool(CF_API_TOKEN),
            "label": cfg.get("label", ""),
            "is_default": root == default,
            "dns_enabled": bool(cfg.get("zone_id") and cfg.get("token")),
            "domain_count": counts.get(root, 0),
            "created_at": cfg.get("created_at"),
        })
    return {"items": items, "default": default, "mail_hostname": MAIL_HOSTNAME}


@app.post("/v1/root-domains", tags=["Domains"], dependencies=[Depends(require_auth)])
def create_root_domain(req: RootDomainCreate) -> dict:
    root = req.root_domain.strip().lower().rstrip(".")
    if not ROOT_DOMAIN_RE.fullmatch(root):
        raise HTTPException(status_code=422, detail="invalid root_domain (expect like example.com)")
    if root in _load_roots():
        raise HTTPException(status_code=409, detail=f"root domain '{root}' already exists")

    zone_id = req.zone_id.strip()
    token = (req.cf_token or "").strip()
    eff_token = token or CF_API_TOKEN

    if req.verify:
        result = _cf_verify(eff_token, zone_id)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail={"msg": "Cloudflare verification failed", "cf": result})

    assert pool is not None
    with pool.connection() as conn, conn.cursor() as cur:
        if req.set_default:
            cur.execute("UPDATE root_domains SET is_default = FALSE WHERE is_default")
        cur.execute(
            "INSERT INTO root_domains (root_domain, zone_id, cf_token, label, is_default) "
            "VALUES (%s, %s, %s, %s, %s)",
            (root, zone_id, token, req.label.strip(), req.set_default),
        )
    _load_roots(force=True)
    return {"ok": True, "root_domain": root, "is_default": req.set_default}


@app.patch("/v1/root-domains/{root}", tags=["Domains"], dependencies=[Depends(require_auth)])
def update_root_domain(root: str, req: RootDomainUpdate) -> dict:
    root = root.strip().lower().rstrip(".")
    roots = _load_roots()
    if root not in roots:
        raise HTTPException(status_code=404, detail=f"root domain '{root}' not found")

    new_zone = req.zone_id.strip() if req.zone_id is not None else roots[root].get("zone_id", "")
    new_token = req.cf_token.strip() if req.cf_token else roots[root].get("raw_token", "")

    if req.verify:
        result = _cf_verify(new_token or CF_API_TOKEN, new_zone)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail={"msg": "Cloudflare verification failed", "cf": result})

    sets: list[str] = []
    params: list = []
    if req.zone_id is not None:
        sets.append("zone_id = %s"); params.append(new_zone)
    if req.cf_token:  # only overwrite when a non-empty token is supplied
        sets.append("cf_token = %s"); params.append(new_token)
    if req.label is not None:
        sets.append("label = %s"); params.append(req.label.strip())

    assert pool is not None
    with pool.connection() as conn, conn.cursor() as cur:
        if req.set_default is True:
            cur.execute("UPDATE root_domains SET is_default = FALSE WHERE is_default")
            sets.append("is_default = TRUE")
        if sets:
            sets.append("updated_at = NOW()")
            cur.execute(f"UPDATE root_domains SET {', '.join(sets)} WHERE root_domain = %s", params + [root])
    _load_roots(force=True)
    return {"ok": True, "root_domain": root}


@app.delete("/v1/root-domains/{root}", tags=["Domains"], dependencies=[Depends(require_auth)])
def delete_root_domain(
    root: str,
    force: Annotated[bool, Query(description="Cascade-delete all sub-domains, mailboxes, Maildir, CF MX records")] = False,
) -> dict:
    root = root.strip().lower().rstrip(".")
    roots = _load_roots()
    if root not in roots:
        raise HTTPException(status_code=404, detail=f"root domain '{root}' not found")

    assert pool is not None
    # find sub-domains under this root
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT tenant_slug, domain FROM domains")
        subs = [r for r in cur.fetchall() if r["domain"].endswith("." + root)]

    if subs and not force:
        raise HTTPException(
            status_code=409,
            detail=f"root '{root}' still has {len(subs)} sub-domain(s). Pass force=true to cascade-delete.",
        )

    purged = []
    for s in subs:
        # reuse the existing domain-delete logic (DNS MX + Maildir + DB cascade)
        try:
            delete_domain(s["tenant_slug"], hard=True)
            purged.append(s["domain"])
        except HTTPException as e:  # pragma: no cover
            log.warning("cascade delete of %s failed: %s", s["domain"], e.detail)

    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM root_domains WHERE root_domain = %s", (root,))
        # ensure there is always a default if any remain
        cur.execute("SELECT COUNT(*) FROM root_domains WHERE is_default")
        if (cur.fetchone() or [0])[0] == 0:
            cur.execute(
                "UPDATE root_domains SET is_default = TRUE WHERE root_domain = "
                "(SELECT root_domain FROM root_domains ORDER BY created_at LIMIT 1)"
            )
    _load_roots(force=True)
    return {"ok": True, "root_domain": root, "purged_subdomains": purged}


@app.post("/v1/root-domains/verify", tags=["Domains"], dependencies=[Depends(require_auth)])
def verify_root_domain(req: RootDomainVerify) -> dict:
    """Check a CF token + zone_id pair without saving. token empty => use global CF_API_TOKEN."""
    token = (req.cf_token or "").strip() or CF_API_TOKEN
    return _cf_verify(token, req.zone_id.strip())


@app.post("/v1/root-domains/cf-zones", tags=["Domains"], dependencies=[Depends(require_auth)])
def list_cf_zones(req: CfZonesRequest) -> dict:
    """List all Cloudflare zones the token can access, so the UI can offer a
    dropdown instead of asking the user to paste a Zone ID. token empty =>
    use global CF_API_TOKEN. Each zone is annotated with whether it is already
    configured as a root domain."""
    token = (req.cf_token or "").strip() or CF_API_TOKEN
    result = _cf_list_zones(token)
    if result.get("ok"):
        existing = set(_load_roots().keys())
        for z in result["zones"]:
            z["already_added"] = z["name"] in existing
    return result


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


@app.get("/v1/stats", tags=["Stats"], dependencies=[Depends(require_auth)])
def stats() -> dict:
    assert pool is not None
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM domains WHERE enabled) AS domains_enabled,
              (SELECT COUNT(*) FROM domains) AS domains_total,
              (SELECT COUNT(*) FROM mailboxes WHERE enabled) AS mailboxes_enabled,
              (SELECT COUNT(*) FROM mailboxes) AS mailboxes_total,
              (SELECT COUNT(*) FROM mailboxes WHERE created_at > NOW() - INTERVAL '24 hours') AS mailboxes_last_24h,
              (SELECT COUNT(*) FROM domains WHERE created_at > NOW() - INTERVAL '24 hours') AS domains_last_24h
            """
        )
        row = cur.fetchone() or {}

    # Best-effort disk usage of vmail
    disk = {"used_bytes": None}
    try:
        total = 0
        for root, _, files in os.walk(VMAIL_ROOT):
            for f in files:
                try:
                    total += (Path(root) / f).stat().st_size
                except OSError:
                    pass
        disk["used_bytes"] = total
    except Exception:
        pass

    return {
        "db": row,
        "disk": disk,
        "root_domain": _default_root(),
        "root_domains": list(_load_roots().keys()),
        "mail_hostname": MAIL_HOSTNAME,
    }


# ---------------------------------------------------------------------------
# Domains
# ---------------------------------------------------------------------------


@app.get("/v1/domains", tags=["Domains"], dependencies=[Depends(require_auth)])
def list_domains(
    q: Annotated[Optional[str], Query(description="Substring filter on tenant_slug or domain")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    assert pool is not None
    params: list = []
    where = ""
    if q:
        where = "WHERE d.tenant_slug ILIKE %s OR d.domain ILIKE %s"
        params.extend([f"%{q}%", f"%{q}%"])
    params.extend([limit, offset])
    sql = f"""
        SELECT d.id AS domain_id, d.tenant_slug, d.domain, d.enabled, d.created_at,
               COALESCE(c.cnt, 0) AS mailbox_count
        FROM domains d
        LEFT JOIN (SELECT domain_id, COUNT(*) AS cnt FROM mailboxes GROUP BY domain_id) c
          ON c.domain_id = d.id
        {where}
        ORDER BY d.id DESC
        LIMIT %s OFFSET %s
    """
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
        cur.execute(
            "SELECT COUNT(*) AS c FROM domains d" + (" " + where if where else ""),
            params[:-2] if q else [],
        )
        total = cur.fetchone()["c"]
    return {"items": rows, "total": total, "limit": limit, "offset": offset}


@app.post("/v1/domains", tags=["Domains"], dependencies=[Depends(require_auth)])
def create_domain(req: DomainCreate) -> dict:
    if req.random or not req.tenant_slug:
        tenant_slug = _gen_slug()
    else:
        tenant_slug = req.tenant_slug.strip().lower()
    if not TENANT_RE.fullmatch(tenant_slug):
        raise HTTPException(status_code=422, detail="tenant_slug supports: a-z, 0-9, -")

    root = _pick_root(req.root_domain)

    assert pool is not None
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT domain_id, domain FROM create_domain(%s, %s)",
            (tenant_slug, root),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create domain")

    dns_result = _ensure_dns_mx(row["domain"])
    return {
        "domain_id": row["domain_id"],
        "tenant_slug": tenant_slug,
        "domain": row["domain"],
        "root_domain": root,
        "dns": dns_result,
    }


@app.delete("/v1/domains/{slug}", tags=["Domains"], dependencies=[Depends(require_auth)])
def delete_domain(
    slug: str,
    hard: Annotated[bool, Query(description="Also purge Maildir and Cloudflare MX record")] = True,
) -> dict:
    slug = slug.strip().lower()
    if not TENANT_RE.fullmatch(slug):
        raise HTTPException(status_code=422, detail="invalid slug")
    assert pool is not None
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT id, domain FROM domains WHERE tenant_slug = %s", (slug,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="domain not found")
        domain = row["domain"]
        cur.execute("DELETE FROM domains WHERE id = %s", (row["id"],))

    dns = _delete_dns_mx(domain) if hard else {"status": "skipped"}

    maildir_result = {"status": "skipped"}
    if hard:
        d = VMAIL_ROOT / domain
        if d.is_dir():
            try:
                shutil.rmtree(d)
                maildir_result = {"status": "deleted", "path": str(d)}
            except Exception as e:
                maildir_result = {"status": "error", "detail": str(e)}
        else:
            maildir_result = {"status": "not_found"}
    return {"ok": True, "domain": domain, "dns": dns, "maildir": maildir_result}


# ---------------------------------------------------------------------------
# Mailboxes
# ---------------------------------------------------------------------------


@app.get("/v1/mailboxes", tags=["Mailboxes"], dependencies=[Depends(require_auth)])
def list_mailboxes(
    domain: Annotated[Optional[str], Query()] = None,
    q: Annotated[Optional[str], Query(description="Substring on email")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    assert pool is not None
    params: list = []
    clauses: list[str] = []
    if domain:
        clauses.append("d.domain = %s")
        params.append(_normalize_domain(domain))
    if q:
        clauses.append("(m.local_part || '@' || d.domain) ILIKE %s")
        params.append(f"%{q.lower()}%")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    count_sql = f"SELECT COUNT(*) AS c FROM mailboxes m JOIN domains d ON d.id = m.domain_id {where}"

    params2 = list(params) + [limit, offset]
    sql = f"""
        SELECT
            m.id AS mailbox_id,
            (m.local_part || '@' || d.domain) AS email,
            m.local_part,
            d.domain,
            m.quota_mb,
            m.enabled,
            m.created_at
        FROM mailboxes m
        JOIN domains d ON d.id = m.domain_id
        {where}
        ORDER BY m.id DESC
        LIMIT %s OFFSET %s
    """
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(count_sql, params)
        total = cur.fetchone()["c"]
        cur.execute(sql, params2)
        rows = cur.fetchall()
    return {"items": rows, "total": total, "limit": limit, "offset": offset}


@app.post("/v1/mailboxes", response_model=MailboxOut, tags=["Mailboxes"], dependencies=[Depends(require_auth)])
def create_mailbox(req: MailboxCreate) -> MailboxOut:
    domain = _normalize_domain(req.domain)
    local_part = (req.local_part or "").strip().lower() if req.local_part else ""
    password = req.password or ""
    auto_pw = False
    if req.random or not local_part:
        local_part = _gen_local_part()
    if req.random or not password:
        password = _gen_password()
        auto_pw = True
    if not LOCAL_PART_RE.fullmatch(local_part):
        raise HTTPException(status_code=422, detail="local_part supports: a-z, 0-9, ., _, -")
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="password must be at least 8 characters")

    assert pool is not None
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT mailbox_id, email FROM create_or_update_mailbox(%s, %s, %s, %s)",
            (domain, local_part, password, req.quota_mb),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create mailbox")
    return MailboxOut(mailbox_id=row["mailbox_id"], email=row["email"], password=password if auto_pw else None)


@app.post("/v1/mailboxes/batch", tags=["Mailboxes"], dependencies=[Depends(require_auth)])
def batch_create(req: MailboxBatchCreate) -> dict:
    assert pool is not None
    items: list[dict] = []
    domain = req.domain
    dns_info: dict | None = None

    if req.new_domain or not domain:
        slug = _gen_slug()
        root = _pick_root(req.root_domain)
        with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT domain_id, domain FROM create_domain(%s, %s)", (slug, root))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=500, detail="Failed to create domain")
            domain = row["domain"]
        dns_info = _ensure_dns_mx(domain)
    else:
        domain = _normalize_domain(domain)

    for _ in range(req.count):
        local_part = _gen_local_part()
        password = _gen_password()
        with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT mailbox_id, email FROM create_or_update_mailbox(%s, %s, %s, %s)",
                (domain, local_part, password, req.quota_mb),
            )
            row = cur.fetchone()
            if row:
                items.append(
                    {
                        "mailbox_id": row["mailbox_id"],
                        "email": row["email"],
                        "password": password,
                        "imap_host": MAIL_HOSTNAME,
                        "imap_port": 993,
                    }
                )
    return {"domain": domain, "dns": dns_info, "count": len(items), "items": items}


@app.get("/v1/mailboxes/{email}", tags=["Mailboxes"], dependencies=[Depends(require_auth)])
def get_mailbox(email: str) -> dict:
    local_part, domain = _split_email(email)
    assert pool is not None
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT m.id AS mailbox_id,
                   (m.local_part || '@' || d.domain) AS email,
                   m.local_part, d.domain, m.quota_mb, m.enabled, m.created_at
            FROM mailboxes m JOIN domains d ON d.id = m.domain_id
            WHERE m.local_part = %s AND d.domain = %s
            """,
            (local_part, domain),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Mailbox not found")
    return row


@app.post("/v1/mailboxes/{email}/reset-password", tags=["Mailboxes"], dependencies=[Depends(require_auth)])
def reset_password(email: str, req: PasswordReset) -> dict:
    local_part, domain = _split_email(email)
    assert pool is not None
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE mailboxes m
            SET password_hash = '{BLF-CRYPT}' || crypt(%s, gen_salt('bf', 10))
            FROM domains d
            WHERE m.domain_id = d.id AND m.local_part = %s AND d.domain = %s
            """,
            (req.password, local_part, domain),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Mailbox not found")
    return {"ok": True}


@app.post("/v1/mailboxes/{email}/disable", tags=["Mailboxes"], dependencies=[Depends(require_auth)])
def disable_mailbox(email: str) -> dict:
    local_part, domain = _split_email(email)
    assert pool is not None
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE mailboxes m
            SET enabled = FALSE
            FROM domains d
            WHERE m.domain_id = d.id AND m.local_part = %s AND d.domain = %s
            """,
            (local_part, domain),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Mailbox not found")
    return {"ok": True}


@app.post("/v1/mailboxes/{email}/enable", tags=["Mailboxes"], dependencies=[Depends(require_auth)])
def enable_mailbox(email: str) -> dict:
    local_part, domain = _split_email(email)
    assert pool is not None
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE mailboxes m
            SET enabled = TRUE
            FROM domains d
            WHERE m.domain_id = d.id AND m.local_part = %s AND d.domain = %s
            """,
            (local_part, domain),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Mailbox not found")
    return {"ok": True}


@app.delete("/v1/mailboxes/{email}", tags=["Mailboxes"], dependencies=[Depends(require_auth)])
def delete_mailbox(
    email: str,
    hard: Annotated[bool, Query(description="Also remove Maildir data")] = True,
) -> dict:
    local_part, domain = _split_email(email)
    assert pool is not None
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM mailboxes
            WHERE id IN (
                SELECT m.id FROM mailboxes m JOIN domains d ON d.id = m.domain_id
                WHERE m.local_part = %s AND d.domain = %s
            )
            """,
            (local_part, domain),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Mailbox not found")

    maildir_result = {"status": "skipped"}
    if hard:
        d = VMAIL_ROOT / domain / local_part
        if d.is_dir():
            try:
                shutil.rmtree(d)
                maildir_result = {"status": "deleted", "path": str(d)}
            except Exception as e:
                maildir_result = {"status": "error", "detail": str(e)}
        else:
            maildir_result = {"status": "not_found"}
    return {"ok": True, "email": f"{local_part}@{domain}", "maildir": maildir_result}


# ---------------------------------------------------------------------------
# Messages (read Maildir)
# ---------------------------------------------------------------------------


def _ensure_mailbox_exists(email: str) -> tuple[str, str]:
    local_part, domain = _split_email(email)
    assert pool is not None
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM mailboxes m JOIN domains d ON d.id = m.domain_id
            WHERE m.local_part = %s AND d.domain = %s
            """,
            (local_part, domain),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="Mailbox not found")
    return local_part, domain


@app.get("/v1/mailboxes/{email}/messages", tags=["Messages"], dependencies=[Depends(require_auth)])
def list_messages(
    email: str,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    _ensure_mailbox_exists(email)
    return maildir.list_messages(email, limit=limit, offset=offset)


@app.get("/v1/mailboxes/{email}/messages/{uid}", tags=["Messages"], dependencies=[Depends(require_auth)])
def get_message(email: str, uid: str) -> dict:
    _ensure_mailbox_exists(email)
    msg = maildir.get_message(email, uid)
    if msg is None:
        raise HTTPException(status_code=404, detail="Message not found")
    return msg


@app.get("/v1/mailboxes/{email}/latest-code", tags=["Messages"], dependencies=[Depends(require_auth)])
def get_latest_code(
    email: str,
    max_scan: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    _ensure_mailbox_exists(email)
    code = maildir.latest_code(email, max_scan=max_scan)
    if code is None:
        raise HTTPException(status_code=404, detail="No verification code found in recent messages")
    return code
