import { ExternalLink, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { copyToClipboard } from "@/lib/utils"
import { getToken } from "@/lib/api"

const API_BASE = "/api"
const endpoints: { method: string; path: string; summary: string }[] = [
  { method: "GET", path: "/v1/auth/verify", summary: "验证 Token" },
  { method: "GET", path: "/v1/stats", summary: "号池统计" },
  { method: "GET", path: "/v1/domains", summary: "列出域名" },
  { method: "POST", path: "/v1/domains", summary: "创建域名 (body: { tenant_slug? , random? })" },
  { method: "DELETE", path: "/v1/domains/{slug}", summary: "删除域名 (级联删除邮箱 + MX + Maildir)" },
  { method: "GET", path: "/v1/mailboxes", summary: "列出邮箱" },
  { method: "POST", path: "/v1/mailboxes", summary: "创建邮箱" },
  { method: "POST", path: "/v1/mailboxes/batch", summary: "批量创建 (count ≤ 100)" },
  { method: "GET", path: "/v1/mailboxes/{email}", summary: "邮箱详情" },
  { method: "POST", path: "/v1/mailboxes/{email}/reset-password", summary: "重置密码" },
  { method: "POST", path: "/v1/mailboxes/{email}/disable", summary: "禁用" },
  { method: "POST", path: "/v1/mailboxes/{email}/enable", summary: "启用" },
  { method: "DELETE", path: "/v1/mailboxes/{email}", summary: "删除邮箱" },
  { method: "GET", path: "/v1/mailboxes/{email}/messages", summary: "收件箱列表" },
  { method: "GET", path: "/v1/mailboxes/{email}/messages/{uid}", summary: "单封邮件" },
  { method: "GET", path: "/v1/mailboxes/{email}/latest-code", summary: "最新验证码（核心便捷端点）" },
]

const methodColor: Record<string, string> = {
  GET: "text-emerald-400 border-emerald-500/30",
  POST: "text-sky-400 border-sky-500/30",
  DELETE: "text-rose-400 border-rose-500/30",
  PUT: "text-amber-400 border-amber-500/30",
}

export function ApiDocs() {
  const token = getToken()
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API 文档</h1>
          <p className="text-sm text-muted-foreground">
            REST API (OpenAPI 3.1)，所有请求需 Bearer Token。
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">
              <ExternalLink /> Swagger UI
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={`${API_BASE}/redoc`} target="_blank" rel="noreferrer">
              <ExternalLink /> ReDoc
            </a>
          </Button>
          <Button asChild>
            <a href={`${API_BASE}/openapi.json`} target="_blank" rel="noreferrer">
              <ExternalLink /> openapi.json
            </a>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>鉴权</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            在每个请求头加入 <code className="rounded bg-muted px-1">Authorization: Bearer &lt;TOKEN&gt;</code>。
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`curl ${API_BASE}/v1/stats \\
  -H "Authorization: Bearer ${token ? token.slice(0, 8) + "..." : "<TOKEN>"}"`}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>端点</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {endpoints.map((e) => (
              <li key={e.method + e.path} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <code
                    className={`inline-flex w-16 justify-center rounded border px-2 py-0.5 text-xs font-semibold ${methodColor[e.method] ?? ""}`}
                  >
                    {e.method}
                  </code>
                  <code className="font-mono text-sm">{e.path}</code>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{e.summary}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async () => {
                      await copyToClipboard(`${e.method} ${API_BASE}${e.path}`)
                      toast.success("已复制")
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>生成 SDK</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>用 <code className="rounded bg-muted px-1">openapi-generator-cli</code> 可从本服务的 OpenAPI 规范生成任意语言 SDK：</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`npx @openapitools/openapi-generator-cli generate \\
  -i ${API_BASE}/openapi.json \\
  -g python \\
  -o ./sdk-python`}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
