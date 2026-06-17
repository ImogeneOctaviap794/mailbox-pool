const TOKEN_KEY = "mail_admin_token"

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ""
}

export function setToken(t: string) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown, message: string) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {}
): Promise<T> {
  const { method = "GET", body, query } = opts
  let url = "/api" + path
  if (query) {
    const usp = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === "" || v === null) continue
      usp.set(k, String(v))
    }
    const q = usp.toString()
    if (q) url += "?" + q
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  })

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const detail =
      (data && typeof data === "object" && (data as { detail?: string }).detail) ||
      res.statusText ||
      `HTTP ${res.status}`
    throw new ApiError(res.status, data, String(detail))
  }
  return data as T
}

// ---------------------------------------------------------------------------
// API Types
// ---------------------------------------------------------------------------

export interface Stats {
  db: {
    domains_enabled: number
    domains_total: number
    mailboxes_enabled: number
    mailboxes_total: number
    mailboxes_last_24h: number
    domains_last_24h: number
  }
  disk: { used_bytes: number | null }
  root_domain: string
  root_domains?: string[]
  mail_hostname: string
}

export interface RootDomain {
  root_domain: string
  is_default: boolean
  dns_enabled: boolean
  zone_id?: string
  token_masked?: string
  has_token?: boolean
  uses_global_token?: boolean
  label?: string
  domain_count?: number
  created_at?: string
}

export interface CfVerifyResult {
  ok: boolean
  zone_name?: string
  detail?: string
  errors?: unknown[]
}

export interface CfZone {
  zone_id: string
  name: string
  status: string
  already_added?: boolean
}

export interface CfZonesResult {
  ok: boolean
  zones?: CfZone[]
  count?: number
  detail?: string
  errors?: unknown[]
}

export interface Domain {
  domain_id: number
  tenant_slug: string
  domain: string
  enabled: boolean
  created_at: string
  mailbox_count: number
}

export interface Mailbox {
  mailbox_id: number
  email: string
  local_part: string
  domain: string
  quota_mb: number
  enabled: boolean
  created_at: string
}

export interface MessageSummary {
  uid: string
  from: string
  to: string
  subject: string
  date: string
  seen: boolean
  size: number
  snippet: string
}

export interface MessageDetail extends MessageSummary {
  cc?: string
  message_id?: string
  body_text: string
  codes: string[]
}

export interface LatestCode {
  code: string
  all_codes: string[]
  from: string
  subject: string
  date: string
  uid: string
}

export interface BatchCreateResult {
  domain: string
  dns: unknown
  count: number
  items: {
    mailbox_id: number
    email: string
    password: string
    imap_host: string
    imap_port: number
  }[]
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export const api = {
  verifyToken: () => request<{ ok: boolean }>("/v1/auth/verify"),
  stats: () => request<Stats>("/v1/stats"),

  listRootDomains: () =>
    request<{ items: RootDomain[]; default: string; mail_hostname: string }>("/v1/root-domains"),
  createRootDomain: (body: {
    root_domain: string
    zone_id: string
    cf_token?: string
    label?: string
    set_default?: boolean
    verify?: boolean
  }) => request<{ ok: boolean; root_domain: string }>("/v1/root-domains", { method: "POST", body }),
  updateRootDomain: (
    root: string,
    body: { zone_id?: string; cf_token?: string; label?: string; set_default?: boolean; verify?: boolean }
  ) =>
    request<{ ok: boolean; root_domain: string }>(`/v1/root-domains/${encodeURIComponent(root)}`, {
      method: "PATCH",
      body,
    }),
  deleteRootDomain: (root: string, force = false) =>
    request<{ ok: boolean; root_domain: string; purged_subdomains: string[] }>(
      `/v1/root-domains/${encodeURIComponent(root)}`,
      { method: "DELETE", query: { force } }
    ),
  verifyRootDomain: (body: { zone_id: string; cf_token?: string }) =>
    request<CfVerifyResult>("/v1/root-domains/verify", { method: "POST", body }),
  listCfZones: (body: { cf_token?: string }) =>
    request<CfZonesResult>("/v1/root-domains/cf-zones", { method: "POST", body }),

  listDomains: (q?: string, limit = 200, offset = 0) =>
    request<{ items: Domain[]; total: number }>("/v1/domains", { query: { q, limit, offset } }),
  createDomain: (body: { tenant_slug?: string; random?: boolean; root_domain?: string }) =>
    request<{ domain_id: number; tenant_slug: string; domain: string; root_domain?: string; dns: unknown }>(
      "/v1/domains",
      { method: "POST", body }
    ),
  deleteDomain: (slug: string, hard = true) =>
    request<{ ok: boolean }>(`/v1/domains/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      query: { hard },
    }),

  listMailboxes: (params: { domain?: string; q?: string; limit?: number; offset?: number }) =>
    request<{ items: Mailbox[]; total: number; limit: number; offset: number }>("/v1/mailboxes", {
      query: params,
    }),
  createMailbox: (body: {
    domain: string
    local_part?: string
    password?: string
    random?: boolean
    quota_mb?: number
  }) =>
    request<{ mailbox_id: number; email: string; password?: string }>("/v1/mailboxes", {
      method: "POST",
      body,
    }),
  batchCreate: (body: {
    domain?: string
    count: number
    quota_mb?: number
    new_domain?: boolean
    root_domain?: string
  }) => request<BatchCreateResult>("/v1/mailboxes/batch", { method: "POST", body }),
  deleteMailbox: (email: string, hard = true) =>
    request<{ ok: boolean }>(`/v1/mailboxes/${encodeURIComponent(email)}`, {
      method: "DELETE",
      query: { hard },
    }),
  resetPassword: (email: string, password: string) =>
    request<{ ok: boolean }>(`/v1/mailboxes/${encodeURIComponent(email)}/reset-password`, {
      method: "POST",
      body: { password },
    }),
  disableMailbox: (email: string) =>
    request<{ ok: boolean }>(`/v1/mailboxes/${encodeURIComponent(email)}/disable`, {
      method: "POST",
    }),
  enableMailbox: (email: string) =>
    request<{ ok: boolean }>(`/v1/mailboxes/${encodeURIComponent(email)}/enable`, {
      method: "POST",
    }),

  listMessages: (email: string, limit = 50, offset = 0) =>
    request<{ items: MessageSummary[]; total: number }>(
      `/v1/mailboxes/${encodeURIComponent(email)}/messages`,
      { query: { limit, offset } }
    ),
  getMessage: (email: string, uid: string) =>
    request<MessageDetail>(
      `/v1/mailboxes/${encodeURIComponent(email)}/messages/${encodeURIComponent(uid)}`
    ),
  latestCode: (email: string, max_scan = 20) =>
    request<LatestCode>(
      `/v1/mailboxes/${encodeURIComponent(email)}/latest-code`,
      { query: { max_scan } }
    ),
}
