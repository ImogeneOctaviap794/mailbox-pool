import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  ArrowLeft, Copy, Mail, RefreshCw, Zap, RotateCw, Clock, User,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { api } from "@/lib/api"
import { cn, copyToClipboard, formatBytes, formatDate } from "@/lib/utils"

export function Inbox() {
  const params = useParams<{ email: string }>()
  const email = decodeURIComponent(params.email || "")
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [selectedUid, setSelectedUid] = useState<string | null>(null)

  const messages = useQuery({
    queryKey: ["messages", email],
    queryFn: () => api.listMessages(email, 50, 0),
    refetchInterval: autoRefresh ? 10_000 : false,
    enabled: !!email,
  })

  const codeMut = useMutation({
    mutationFn: () => api.latestCode(email, 20),
    onSuccess: (d) => {
      toast.success(`验证码：${d.code}`, {
        description: `来自：${d.from}`,
        duration: 20000,
        action: {
          label: "复制",
          onClick: () => copyToClipboard(d.code).then(() => toast.success("已复制到剪贴板")),
        },
      })
      // auto-copy
      copyToClipboard(d.code)
    },
    onError: (e: Error) => toast.error("未找到验证码", { description: e.message }),
  })

  const detail = useQuery({
    queryKey: ["message", email, selectedUid],
    queryFn: () => api.getMessage(email, selectedUid!),
    enabled: !!selectedUid,
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/mailboxes"><ArrowLeft /></Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Mail className="h-5 w-5 text-primary" />
              <span className="font-mono text-base">{email}</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              共 {messages.data?.total ?? 0} 封邮件
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => codeMut.mutate()}
            disabled={codeMut.isPending}
            variant="default"
          >
            <Zap /> {codeMut.isPending ? "提取中..." : "提取最新验证码"}
          </Button>
          <Button
            variant={autoRefresh ? "secondary" : "outline"}
            onClick={() => setAutoRefresh((v) => !v)}
          >
            <RotateCw className={cn("h-4 w-4", autoRefresh && "animate-spin")} />
            {autoRefresh ? "停止轮询" : "每 10s 刷新"}
          </Button>
          <Button variant="outline" onClick={() => messages.refetch()}>
            <RefreshCw className={cn("h-4 w-4", messages.isFetching && "animate-spin")} />
            刷新
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await copyToClipboard(email)
              toast.success("邮箱地址已复制")
            }}
          >
            <Copy /> 复制地址
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card className="max-h-[calc(100vh-12rem)] overflow-hidden">
          <CardHeader className="flex-row items-center justify-between py-3">
            <CardTitle className="text-sm font-medium">邮件列表</CardTitle>
            {messages.isFetching && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
          </CardHeader>
          <CardContent className="overflow-y-auto p-0">
            {messages.isLoading && <div className="p-6 text-sm text-muted-foreground">加载中...</div>}
            {messages.data && messages.data.items.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                暂无邮件。发送一封到 <code className="rounded bg-muted px-1">{email}</code> 试试。
              </div>
            )}
            <ul className="divide-y">
              {messages.data?.items.map((m) => (
                <li
                  key={m.uid}
                  onClick={() => setSelectedUid(m.uid)}
                  className={cn(
                    "cursor-pointer p-3 transition-colors hover:bg-accent/50",
                    selectedUid === m.uid && "bg-accent",
                    !m.seen && "border-l-2 border-l-primary"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{m.from || "(unknown)"}</span>
                        {!m.seen && <Badge variant="secondary" className="shrink-0">new</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-sm">{m.subject || "(no subject)"}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{m.snippet}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      {formatDate(m.date)}
                      <div className="mt-0.5">{formatBytes(m.size)}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="max-h-[calc(100vh-12rem)] overflow-hidden">
          <CardContent className="h-full overflow-y-auto p-0">
            {!selectedUid && (
              <div className="flex h-full min-h-[400px] flex-col items-center justify-center text-muted-foreground">
                <Mail className="mb-3 h-10 w-10 opacity-50" />
                选择左侧邮件查看正文
              </div>
            )}
            {selectedUid && detail.isLoading && (
              <div className="p-6 text-sm text-muted-foreground">加载中...</div>
            )}
            {detail.data && (
              <div className="space-y-4 p-6">
                <div>
                  <h2 className="text-lg font-semibold">{detail.data.subject || "(no subject)"}</h2>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2"><User className="h-3 w-3" /> {detail.data.from}</div>
                    <div className="flex items-center gap-2"><Clock className="h-3 w-3" /> {formatDate(detail.data.date)}</div>
                  </div>
                </div>
                {detail.data.codes.length > 0 && (
                  <Card className="border-primary/40 bg-primary/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Zap className="h-4 w-4 text-primary" /> 识别到的验证码
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      {detail.data.codes.map((c) => (
                        <Button
                          key={c}
                          variant="secondary"
                          size="sm"
                          className="font-mono text-base tracking-wider"
                          onClick={async () => {
                            await copyToClipboard(c)
                            toast.success(`已复制：${c}`)
                          }}
                        >
                          {c} <Copy className="ml-1 h-3 w-3" />
                        </Button>
                      ))}
                    </CardContent>
                  </Card>
                )}
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-4 text-sm">
                  {detail.data.body_text || "(空正文)"}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
