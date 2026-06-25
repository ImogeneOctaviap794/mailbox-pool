# Mailbox Pool · 自建多租户 IMAP 邮件平台

基于 Postfix + Dovecot + PostgreSQL + FastAPI + React 的自托管邮箱池。通过 REST API
或 Web 控制台批量创建租户域名 / 邮箱，自动管理 Cloudflare MX 记录，并内置收件箱查看
与验证码提取，非常适合做"接码 / 临时邮箱"后端。

**邮箱格式**: `<user>@mail.<tenant>.<root>`（例如 `alice@mail.acme.example.com`）

> ⚠️ 本平台只负责**接收**邮件，不对外发信（无 SMTP submission）。

## 功能特性

- 多租户：一个根域名下可派生任意数量 `mail.<tenant>.<root>` 子域名
- **多根域名**：根域名存在 PostgreSQL，每个绑定独立的 Cloudflare Zone + Token，支持多 CF 账号混管
- **Cloudflare 自动化**：创建租户即自动写 MX 记录；删除即清理
- Web 控制台：域名 / 邮箱 / 根域名管理、收件箱查看、验证码提取、内置 API 文档
- 验证码提取：`/latest-code` 自动从最近邮件中识别 4-8 位验证码
- 全程 Bearer Token 鉴权；Admin API 默认不暴露公网端口，仅经前端 Nginx 反代访问

## 架构

| 组件 | 技术 | 端口 | 作用 |
|------|------|------|------|
| Postfix | SMTP MTA | 25 | 接收外部邮件 |
| Dovecot | IMAP + LMTP | 143 / 993 | 存储邮件 & 客户端读取 |
| PostgreSQL | 16 Alpine | 内部 | 域名/邮箱元数据 |
| Admin API | FastAPI | 8080 | 管理接口 |
| mail-web | React + Nginx | 8081 | Web 控制台 + `/api` 反代 |

> Admin API 容器不映射宿主端口，只能经 `mail-web` 的 Nginx 在 `http://<host>:8081/api/*`
> 访问，缩小攻击面。

## 快速开始

```bash
# 1. 准备配置
cp .env.example .env
# 编辑 .env：设置数据库密码、ADMIN_API_TOKEN、ROOT_DOMAIN、（可选）Cloudflare 凭证

# 2. 准备 TLS 证书到 certs/（生产用 Let's Encrypt；本地测试可自签）
make cert            # 生成自签证书，或手动放入 certs/fullchain.pem + privkey.pem

# 3. 启动
make up              # = docker compose up -d --build

# 4. 打开控制台
#   http://<host>:8081   登录方式：只填 ADMIN_API_TOKEN（无用户名/密码）
```

**DNS 前置条件**：`MAIL_HOSTNAME`（如 `mx1.example.com`）的 A 记录指向本机公网 IP；
每个根域名的 25 端口需可从公网入站。配置 Cloudflare 凭证后，租户子域的 MX 记录会自动创建。

## 环境变量

见 `.env.example`。要点：

| 变量 | 说明 |
|------|------|
| `POSTGRES_PASSWORD` | 数据库密码 |
| `ADMIN_API_TOKEN` | API + 控制台登录令牌，建议 `openssl rand -hex 24` |
| `ROOT_DOMAIN` / `MAIL_HOSTNAME` | 默认根域名与公网 MX 主机名 |
| `CF_API_TOKEN` / `CF_ZONE_ID` | 全局 Cloudflare 兜底凭证（per-root 未配置时回退） |
| `ROOT_DOMAINS` | **仅首次启动种子**，之后在控制台「根域名」页管理 |

---

# API 接口文档

**Base URL**: `http://<host>:8081/api`（经 mail-web 反代；若直连 Admin API 容器则为 `:8080`）

**认证方式**: 所有 `/v1/*` 接口需要 Bearer Token：

```
Authorization: Bearer YOUR_ADMIN_TOKEN
```

---

## 1. 健康检查

```
GET /health
```

无需认证。

**Response** `200`:
```json
{"status": "ok"}
```

---

## 2. 创建租户域名

```
POST /v1/domains
```

创建一个新的租户域名。系统自动生成 `mail.<tenant_slug>.niji.edu.rs`，并通过 Cloudflare API 自动创建 MX 记录。

**Request Body**:
```json
{
  "tenant_slug": "acme"
}
```

| 字段 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| `tenant_slug` | string | ✅ | 1-63字符，仅 `a-z 0-9 -` | 租户标识 |

**Response** `200`:
```json
{
  "domain_id": 1,
  "domain": "mail.acme.example.com",
  "dns": {
    "dns": "created",
    "record_id": "xxx"
  }
}
```

`dns` 字段说明：
| 值 | 含义 |
|----|------|
| `created` | 新建了 MX 记录 |
| `exists` | MX 记录已存在 |
| `skipped` | 未配置 Cloudflare 凭证 |
| `error` | DNS 创建失败（不影响域名创建） |

**错误**:
| 状态码 | 原因 |
|--------|------|
| 401 | Token 缺失或无效 |
| 422 | tenant_slug 格式不合法 |

**注意**: 重复创建同一 tenant_slug 会更新（upsert），不会报错。

---

## 3. 创建 / 更新邮箱

```
POST /v1/mailboxes
```

在指定域名下创建邮箱。如果邮箱已存在，更新密码和配额。

**Request Body**:
```json
{
  "domain": "mail.acme.example.com",
  "local_part": "alice",
  "password": "StrongPass123!",
  "quota_mb": 1024
}
```

| 字段 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| `domain` | string | ✅ | 必须是已创建的域名 | 租户域名 |
| `local_part` | string | ✅ | 1-64字符，仅 `a-z 0-9 . _ -` | 邮箱名 |
| `password` | string | ✅ | 8-256字符 | IMAP 登录密码 |
| `quota_mb` | int | ❌ | 1-102400，默认 1024 | 邮箱配额 (MB) |

**Response** `200`:
```json
{
  "mailbox_id": 1,
  "email": "alice@mail.acme.example.com"
}
```

**错误**:
| 状态码 | 原因 |
|--------|------|
| 401 | Token 无效 |
| 422 | 参数格式错误或域名不存在 |

---

## 4. 列出邮箱

```
GET /v1/mailboxes
```

分页列出所有邮箱，支持按域名过滤。

**Query Parameters**:

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `domain` | string | ❌ | - | 按域名过滤，如 `mail.acme.example.com` |
| `limit` | int | ❌ | 100 | 每页条数 (1-500) |
| `offset` | int | ❌ | 0 | 偏移量 |

**Response** `200`:
```json
{
  "items": [
    {
      "mailbox_id": 1,
      "email": "alice@mail.acme.example.com",
      "quota_mb": 1024,
      "enabled": true,
      "domain": "mail.acme.example.com"
    }
  ],
  "limit": 100,
  "offset": 0
}
```

---

## 5. 重置邮箱密码

```
POST /v1/mailboxes/{email}/reset-password
```

**Path Parameter**: `email` — 完整邮箱地址（需 URL 编码 `@` 为 `%40`）

**Request Body**:
```json
{
  "password": "NewStrongPass456!"
}
```

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `password` | string | ✅ | 8-256字符 |

**Response** `200`:
```json
{"ok": true}
```

**错误**: `404` 邮箱不存在

---

## 6. 禁用邮箱

```
POST /v1/mailboxes/{email}/disable
```

禁用后该邮箱无法登录 IMAP，也不再接收邮件。

**Path Parameter**: `email` — 完整邮箱地址

**Response** `200`:
```json
{"ok": true}
```

**错误**: `404` 邮箱不存在

> 完整接口（批量创建、启用邮箱、删除域名/邮箱、收件箱列表 `/messages`、邮件详情、
> `/latest-code` 验证码提取、`/v1/stats` 统计等）见控制台内置的 Swagger 文档：
> `http://<host>:8081/api/docs`。

---

## 7. 根域名管理

根域名持久化在 `root_domains` 表，可在控制台「根域名」页或通过以下接口管理。
每个根域名绑定独立的 Cloudflare Zone ID + API Token，支持多 CF 账号混管。

```
GET    /v1/root-domains              列出（zone_id / 掩码 token / 子域数 / 默认标记）
POST   /v1/root-domains              新增
PATCH  /v1/root-domains/{root}       修改 zone_id / token / 备注 / 默认（token 留空不改）
DELETE /v1/root-domains/{root}       删除（?force=true 级联删子域+邮箱+Maildir+CF MX）
POST   /v1/root-domains/verify       校验 token + zone_id 配对（不落库）
POST   /v1/root-domains/cf-zones     列出该 token 可访问的所有 Cloudflare zone
```

**新增根域名**（`POST /v1/root-domains`）：
```json
{
  "root_domain": "example.com",
  "zone_id": "<cloudflare_zone_id>",
  "cf_token": "<cf_api_token>",
  "label": "CF 账号 #1",
  "set_default": false,
  "verify": true
}
```
| 字段 | 必填 | 说明 |
|------|------|------|
| `root_domain` | ✅ | 形如 `example.com` |
| `zone_id` | ✅ | Cloudflare Zone ID |
| `cf_token` | ❌ | 留空则回退全局 `CF_API_TOKEN` |
| `label` | ❌ | 备注，例如 CF 账号编号 |
| `set_default` | ❌ | 设为新建子域名时的默认根 |
| `verify` | ❌ | 落库前先向 Cloudflare 校验凭证 |

**从 Token 拉取可用 zone**（`POST /v1/root-domains/cf-zones`，`cf_token` 留空用全局）：
```json
{ "ok": true, "count": 2, "zones": [
  { "zone_id": "abc...", "name": "example.com", "status": "active", "already_added": false }
] }
```
控制台「新增根域名」即用此接口：填入 Token → 拉取域名 → 下拉选择，`root_domain`
与 `zone_id` 自动带出，无需手动复制 Zone ID。

---

# 使用示例

## 完整流程 (cURL)

```bash
TOKEN="YOUR_ADMIN_TOKEN"
API="http://<host>:8081/api"

# 1. 创建租户（自动注册 DNS MX 记录）
curl -sS -X POST "$API/v1/domains" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tenant_slug":"myapp"}'
# → {"domain_id":1,"domain":"mail.myapp.example.com","dns":{"dns":"created","record_id":"xxx"}}

# 2. 创建邮箱
curl -sS -X POST "$API/v1/mailboxes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain":"mail.myapp.example.com","local_part":"user1","password":"Pass1234!","quota_mb":2048}'
# → {"mailbox_id":1,"email":"user1@mail.myapp.example.com"}

# 3. 查询邮箱
curl -sS "$API/v1/mailboxes?domain=mail.myapp.example.com" \
  -H "Authorization: Bearer $TOKEN"

# 4. 重置密码
curl -sS -X POST "$API/v1/mailboxes/user1%40mail.myapp.example.com/reset-password" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"NewPass5678!"}'

# 5. 禁用邮箱
curl -sS -X POST "$API/v1/mailboxes/user1%40mail.myapp.example.com/disable" \
  -H "Authorization: Bearer $TOKEN"
```

## IMAP 客户端配置

| 设置 | 值 |
|------|-----|
| **协议** | IMAP |
| **服务器** | `<host>` |
| **端口** | `993` |
| **加密** | SSL/TLS |
| **用户名** | 完整邮箱（如 `user1@mail.myapp.example.com`） |
| **密码** | 创建时设定的密码 |

---

# 运维

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f

# 重启
docker compose restart

# 停止 / 启动
docker compose down
docker compose up -d
```

---

# 注意事项

- 创建租户时自动通过 Cloudflare API 添加 `mail.<tenant>.<root>` 的 MX 记录
- 配置 Cloudflare 凭证（全局 `CF_API_TOKEN`/`CF_ZONE_ID`，或在控制台为每个根域名单独配置）后才会自动注册 DNS
- 默认使用自签名 TLS 证书，生产环境请替换为 Let's Encrypt 等 CA 证书
- 该平台只负责**接收邮件**，不支持通过 SMTP 对外发信
- `.env` 与 `certs/*.pem` 含敏感信息，已在 `.gitignore` 中排除，请勿提交

# 性能与扩容

面向"接码 / 临时邮箱"场景（大量邮箱、平时空闲、突发并发收信与收码）做了如下调优。
**邮箱数量本身不是瓶颈**——9w 邮箱元数据仅约 30MB，inode 占用约 3%，单机可轻松支撑
10w+ 乃至更多；真正的命脉是收信投递并发与读码接口吞吐。

**admin-api（读码吞吐 + 内存）**
- 以 gunicorn 多 worker 运行（`WEB_CONCURRENCY`/`ADMIN_API_WORKERS`，默认 4），吃满多核
- `--max-requests` 周期性回收 worker，杜绝内存只涨不降（实测常驻内存从 ~3.7GB 降到 ~190MB）
- Maildir 读取用单次 `scandir` + `heapq.nlargest` 取最近 N 封，开销与邮箱邮件总数解耦
- 解析默认只读邮件前 `MAILDIR_MAX_PARSE_BYTES`（默认 256KB），避免大附件邮件吃内存
- `latest-code` 加 `LATEST_CODE_CACHE_TTL`（默认 3s）短缓存，挡掉高频轮询的重复扫描
- compose 层 `mem_limit: 2g` 硬顶兜底

**收信链路（Postfix / Dovecot 并发）**
- Postfix `default_process_limit=300`、`lmtp_destination_concurrency_limit=50`，应对突发投递
- Dovecot 预热 LMTP 进程池（`process_min_avail`）、auth worker 池、imap-login 高性能模式

**线上实测**：约 9.4w 邮箱单机运行，admin-api 常驻内存稳定在 ~210MB，
读码接口响应 ~2ms，持续收信约 2.4 封/秒，磁盘/inode 占用平稳。

**再往上扩（按需）**
- 第 1 档：PgBouncer 连接池、邮件存储独立挂盘、Maildir 三级 hash
- 第 2 档：Dovecot 多实例 + 共享/对象存储、Postfix 无状态化 + LB 按域分片、PG 主从读写分离

# License

MIT
