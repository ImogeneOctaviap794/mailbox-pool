import { useQuery } from "@tanstack/react-query"
import { Globe, Mail, Clock, HardDrive } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"
import { formatBytes } from "@/lib/utils"

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.stats(),
    refetchInterval: 15_000,
  })

  const cards = [
    {
      label: "域名",
      value: data?.db.domains_enabled ?? 0,
      sub: `全部 ${data?.db.domains_total ?? 0}，24h 新增 ${data?.db.domains_last_24h ?? 0}`,
      icon: Globe,
      color: "text-sky-400",
    },
    {
      label: "邮箱",
      value: data?.db.mailboxes_enabled ?? 0,
      sub: `全部 ${data?.db.mailboxes_total ?? 0}，24h 新增 ${data?.db.mailboxes_last_24h ?? 0}`,
      icon: Mail,
      color: "text-violet-400",
    },
    {
      label: "近 24h 新增邮箱",
      value: data?.db.mailboxes_last_24h ?? 0,
      sub: "过去 24 小时创建的邮箱数",
      icon: Clock,
      color: "text-emerald-400",
    },
    {
      label: "磁盘占用",
      value: formatBytes(data?.disk.used_bytes),
      sub: "vmail 数据目录体积",
      icon: HardDrive,
      color: "text-amber-400",
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">概览</h1>
        <p className="text-sm text-muted-foreground">
          根域名: <code className="rounded bg-muted px-1 py-0.5 text-xs">{data?.root_domain}</code>
          {" · "}
          MX: <code className="rounded bg-muted px-1 py-0.5 text-xs">{data?.mail_hostname}</code>
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{isLoading ? "..." : c.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>快速开始</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <div className="font-medium">1. 创建域名</div>
            <pre className="mt-1 overflow-x-auto rounded bg-muted p-3 text-xs">
{`curl -X POST http://<HOST>/api/v1/domains \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"random": true}'`}
            </pre>
          </div>
          <div>
            <div className="font-medium">2. 批量创建邮箱</div>
            <pre className="mt-1 overflow-x-auto rounded bg-muted p-3 text-xs">
{`curl -X POST http://<HOST>/api/v1/mailboxes/batch \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"new_domain": true, "count": 10}'`}
            </pre>
          </div>
          <div>
            <div className="font-medium">3. 获取最新验证码</div>
            <pre className="mt-1 overflow-x-auto rounded bg-muted p-3 text-xs">
{`curl http://<HOST>/api/v1/mailboxes/<EMAIL>/latest-code \\
  -H "Authorization: Bearer <TOKEN>"`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
