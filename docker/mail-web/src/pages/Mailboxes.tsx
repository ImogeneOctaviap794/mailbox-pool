import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Search, Trash2, Copy, Inbox as InboxIcon, Layers, Download, KeyRound } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal } from "lucide-react"
import { api, type BatchCreateResult } from "@/lib/api"
import { copyToClipboard, formatDate } from "@/lib/utils"

export function Mailboxes() {
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const domain = sp.get("domain") || ""
  const [q, setQ] = useState("")
  const [openCreate, setOpenCreate] = useState(false)
  const [openBatch, setOpenBatch] = useState(false)
  const [openBatchResult, setOpenBatchResult] = useState<BatchCreateResult | null>(null)

  const list = useQuery({
    queryKey: ["mailboxes", domain, q],
    queryFn: () => api.listMailboxes({ domain: domain || undefined, q: q || undefined, limit: 500 }),
  })

  const domains = useQuery({
    queryKey: ["domains-all"],
    queryFn: () => api.listDomains(undefined, 500),
  })

  const createMut = useMutation({
    mutationFn: (body: { domain: string; local_part?: string; password?: string; random?: boolean }) =>
      api.createMailbox(body),
    onSuccess: (d) => {
      if (d.password) {
        toast.success("邮箱已创建", {
          description: `${d.email}\n密码：${d.password}`,
          duration: 15000,
          action: {
            label: "复制密码",
            onClick: () => copyToClipboard(d.password!).then(() => toast.success("已复制")),
          },
        })
      } else {
        toast.success("邮箱已创建", { description: d.email })
      }
      setOpenCreate(false)
      qc.invalidateQueries({ queryKey: ["mailboxes"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
    onError: (e: Error) => toast.error("创建失败", { description: e.message }),
  })

  const batchMut = useMutation({
    mutationFn: (body: { domain?: string; count: number; new_domain?: boolean; root_domain?: string }) =>
      api.batchCreate(body),
    onSuccess: (d) => {
      setOpenBatch(false)
      setOpenBatchResult(d)
      qc.invalidateQueries({ queryKey: ["mailboxes"] })
      qc.invalidateQueries({ queryKey: ["domains"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
    onError: (e: Error) => toast.error("批量创建失败", { description: e.message }),
  })

  const delMut = useMutation({
    mutationFn: (email: string) => api.deleteMailbox(email, true),
    onSuccess: () => {
      toast.success("邮箱已删除")
      qc.invalidateQueries({ queryKey: ["mailboxes"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
    onError: (e: Error) => toast.error("删除失败", { description: e.message }),
  })

  const resetMut = useMutation({
    mutationFn: (v: { email: string; password: string }) => api.resetPassword(v.email, v.password),
    onSuccess: (_, v) => {
      toast.success("密码已重置", {
        description: `${v.email}\n新密码：${v.password}`,
        duration: 15000,
        action: {
          label: "复制",
          onClick: () => copyToClipboard(v.password).then(() => toast.success("已复制")),
        },
      })
    },
    onError: (e: Error) => toast.error("重置失败", { description: e.message }),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">邮箱</h1>
          <p className="text-sm text-muted-foreground">
            管理号池中的邮箱账号（local_part@domain）
            {domain && (
              <>
                {" · 过滤："}
                <Badge variant="secondary" className="ml-1">
                  {domain}
                  <button onClick={() => { sp.delete("domain"); setSp(sp) }} className="ml-1 text-muted-foreground hover:text-foreground">×</button>
                </Badge>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <CreateDialog
            open={openCreate}
            onOpenChange={setOpenCreate}
            onSubmit={(b) => createMut.mutate(b)}
            pending={createMut.isPending}
            defaultDomain={domain}
            domains={domains.data?.items.map((x) => x.domain) ?? []}
          />
          <BatchDialog
            open={openBatch}
            onOpenChange={setOpenBatch}
            onSubmit={(b) => batchMut.mutate(b)}
            pending={batchMut.isPending}
            defaultDomain={domain}
            domains={domains.data?.items.map((x) => x.domain) ?? []}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索邮箱..."
            className="pl-8"
          />
        </div>
        <div className="text-sm text-muted-foreground">共 {list.data?.total ?? 0} 个</div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>邮箱</TableHead>
              <TableHead>配额</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">加载中...</TableCell>
              </TableRow>
            )}
            {list.data?.items.map((m) => (
              <TableRow key={m.mailbox_id}>
                <TableCell className="font-mono text-xs">{m.email}</TableCell>
                <TableCell>{m.quota_mb} MB</TableCell>
                <TableCell>
                  {m.enabled ? (
                    <Badge variant="success">enabled</Badge>
                  ) : (
                    <Badge variant="secondary">disabled</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">{formatDate(m.created_at)}</TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" size="icon" title="查看收件箱">
                    <Link to={`/inbox/${encodeURIComponent(m.email)}`}>
                      <InboxIcon />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="复制邮箱"
                    onClick={async () => {
                      await copyToClipboard(m.email)
                      toast.success("邮箱已复制")
                    }}
                  >
                    <Copy />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon"><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => {
                        const pw = prompt(`为 ${m.email} 设置新密码 (留空自动生成)：`)
                        if (pw === null) return
                        const finalPw = pw || randomPassword()
                        resetMut.mutate({ email: m.email, password: finalPw })
                      }}>
                        <KeyRound /> 重置密码
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={async () => {
                        const pw = prompt("请输入该邮箱密码用于生成 IMAP 连接串（不会提交到服务器）：")
                        if (!pw) return
                        const conn = `imaps://${encodeURIComponent(m.email)}:${encodeURIComponent(pw)}@${m.domain.replace(/^mail\./, "mx1.").split(".").slice(1).join(".") ? m.domain : "mx1"}:993`
                        await copyToClipboard(conn)
                        toast.success("IMAP 连接串已复制")
                      }}>
                        <Copy /> 复制连接串
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          if (confirm(`确定删除 ${m.email} 吗？\n会同时删除 Maildir 数据。`)) {
                            delMut.mutate(m.email)
                          }
                        }}
                      >
                        <Trash2 /> 删除邮箱
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {list.data && list.data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">暂无数据</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <BatchResultDialog result={openBatchResult} onClose={() => setOpenBatchResult(null)} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function CreateDialog(props: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSubmit: (b: { domain: string; local_part?: string; password?: string; random?: boolean }) => void
  pending: boolean
  defaultDomain: string
  domains: string[]
}) {
  const [domain, setDomain] = useState(props.defaultDomain)
  const [localPart, setLocalPart] = useState("")
  const [password, setPassword] = useState("")

  const list = props.domains
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" onClick={() => setDomain(props.defaultDomain || list[0] || "")}>
          <Plus /> 新建
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建邮箱</DialogTitle>
          <DialogDescription>为指定域名创建一个邮箱；留空则自动生成。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>域名</Label>
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="">(选择一个域名)</option>
              {list.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>local_part (可空)</Label>
              <Input value={localPart} onChange={(e) => setLocalPart(e.target.value.toLowerCase())} placeholder="alice" />
            </div>
            <div className="space-y-1.5">
              <Label>密码 (可空)</Label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="留空随机" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (!domain) return
              props.onSubmit({
                domain,
                local_part: localPart || undefined,
                password: password || undefined,
                random: !localPart && !password,
              })
            }}
            disabled={!domain || props.pending}
          >
            {props.pending ? "创建中..." : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BatchDialog(props: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSubmit: (b: { domain?: string; count: number; new_domain?: boolean; root_domain?: string }) => void
  pending: boolean
  defaultDomain: string
  domains: string[]
}) {
  const [mode, setMode] = useState<"existing" | "new">(props.defaultDomain ? "existing" : "new")
  const [domain, setDomain] = useState(props.defaultDomain || "")
  const [count, setCount] = useState(10)
  const [root, setRoot] = useState("")
  const list = props.domains

  const roots = useQuery({
    queryKey: ["root-domains"],
    queryFn: () => api.listRootDomains(),
  })
  const rootOptions = roots.data?.items ?? []
  const defaultRoot = roots.data?.default ?? ""
  const effectiveRoot = root || defaultRoot

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Layers /> 批量创建
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量创建邮箱</DialogTitle>
          <DialogDescription>一次最多 100 个。完成后会显示明文密码（仅一次）。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={mode === "existing" ? "default" : "outline"} onClick={() => setMode("existing")}>已有域名</Button>
            <Button size="sm" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")}>创建新域名</Button>
          </div>
          {mode === "existing" && (
            <div className="space-y-1.5">
              <Label>域名</Label>
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">(选择一个域名)</option>
                {list.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          {mode === "new" && rootOptions.length > 1 && (
            <div className="space-y-1.5">
              <Label>根域名</Label>
              <select
                value={effectiveRoot}
                onChange={(e) => setRoot(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                {rootOptions.map((r) => (
                  <option key={r.root_domain} value={r.root_domain}>
                    {r.root_domain}{r.is_default ? " (默认)" : ""}{!r.dns_enabled ? " · DNS未配置" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>数量 (1 - 100)</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (mode === "existing" && !domain) return
              props.onSubmit(
                mode === "new"
                  ? { count, new_domain: true, root_domain: effectiveRoot || undefined }
                  : { count, domain }
              )
            }}
            disabled={props.pending || (mode === "existing" && !domain)}
          >
            {props.pending ? "创建中..." : `创建 ${count} 个`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BatchResultDialog({ result, onClose }: { result: BatchCreateResult | null; onClose: () => void }) {
  const csv = useMemo(() => {
    if (!result) return ""
    const rows = [
      ["email", "password", "imap_host", "imap_port"],
      ...result.items.map((x) => [x.email, x.password, x.imap_host, String(x.imap_port)]),
    ]
    return rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n")
  }, [result])

  if (!result) return null
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={!!result} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>批量创建完成 · {result.count} 个</DialogTitle>
          <DialogDescription>
            域名: <code className="rounded bg-muted px-1">{result.domain}</code>
            。请立即导出，密码只显示一次。
          </DialogDescription>
        </DialogHeader>
        <Textarea value={csv} readOnly rows={12} className="font-mono text-xs" />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => copyToClipboard(csv).then(() => toast.success("CSV 已复制"))}>
            <Copy /> 复制 CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `mailboxes-${Date.now()}.csv`)}
          >
            <Download /> 下载 CSV
          </Button>
          <Button
            onClick={() =>
              download(new Blob([JSON.stringify(result.items, null, 2)], { type: "application/json" }), `mailboxes-${Date.now()}.json`)
            }
          >
            <Download /> 下载 JSON
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function randomPassword(): string {
  const a = "abcdefghijkmnpqrstuvwxyz"
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ"
  const n = "23456789"
  const s = "!@#$%&*"
  const all = a + A + n + s
  let out = ""
  for (let i = 0; i < 16; i++) out += all[Math.floor(Math.random() * all.length)]
  return out
}
