import { useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Search, Trash2, Copy, Shuffle, ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { copyToClipboard, formatDate } from "@/lib/utils"

export function Domains() {
  const qc = useQueryClient()
  const [q, setQ] = useState("")
  const [openCreate, setOpenCreate] = useState(false)
  const [slug, setSlug] = useState("")
  const [root, setRoot] = useState("")
  const [withMailbox, setWithMailbox] = useState(true)

  const list = useQuery({
    queryKey: ["domains", q],
    queryFn: () => api.listDomains(q || undefined),
  })

  const roots = useQuery({
    queryKey: ["root-domains"],
    queryFn: () => api.listRootDomains(),
  })

  const rootOptions = roots.data?.items ?? []
  const defaultRoot = roots.data?.default ?? ""
  const effectiveRoot = root || defaultRoot

  const createMut = useMutation({
    mutationFn: async (random: boolean) => {
      const domainResp = await api.createDomain(
        random
          ? { random: true, root_domain: effectiveRoot || undefined }
          : { tenant_slug: slug, root_domain: effectiveRoot || undefined }
      )
      let mailbox: { email: string; password?: string } | null = null
      if (withMailbox) {
        try {
          const mb = await api.createMailbox({ domain: domainResp.domain, random: true })
          mailbox = { email: mb.email, password: mb.password }
        } catch (e) {
          // 邮箱创建失败不阶叠在域名创建上，单独提示
          toast.error("邮箱随机创建失败", { description: (e as Error).message })
        }
      }
      return { domain: domainResp, mailbox }
    },
    onSuccess: ({ domain, mailbox }) => {
      if (mailbox) {
        toast.success("域名 + 邮箱已创建", {
          description: `${domain.domain}\n${mailbox.email}\n密码：${mailbox.password}`,
          duration: 20000,
          action: mailbox.password
            ? {
                label: "复制邮箱+密码",
                onClick: () =>
                  copyToClipboard(`${mailbox.email}\t${mailbox.password}`).then(() =>
                    toast.success("已复制")
                  ),
              }
            : undefined,
        })
      } else {
        toast.success("域名已创建", { description: domain.domain })
      }
      setOpenCreate(false)
      setSlug("")
      setRoot("")
      qc.invalidateQueries({ queryKey: ["domains"] })
      qc.invalidateQueries({ queryKey: ["mailboxes"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
    onError: (e: Error) => toast.error("创建失败", { description: e.message }),
  })

  const delMut = useMutation({
    mutationFn: (slug: string) => api.deleteDomain(slug, true),
    onSuccess: () => {
      toast.success("域名已删除")
      qc.invalidateQueries({ queryKey: ["domains"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
    onError: (e: Error) => toast.error("删除失败", { description: e.message }),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">域名</h1>
          <p className="text-sm text-muted-foreground">管理租户子域名（mail.&lt;slug&gt;.&lt;root&gt;）</p>
        </div>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button>
              <Plus /> 新建
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>创建域名</DialogTitle>
              <DialogDescription>
                自定义 slug 或随机生成。创建后会自动写入 Cloudflare MX 记录。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {rootOptions.length > 1 && (
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
                <Label>Slug (留空则随机)</Label>
                <Input
                  placeholder="例如：shop"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                />
              </div>
              {effectiveRoot && (
                <p className="text-xs text-muted-foreground">
                  预览：<code className="rounded bg-muted px-1">mail.{slug || "<random>"}.{effectiveRoot}</code>
                </p>
              )}
              <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={withMailbox}
                  onChange={(e) => setWithMailbox(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                同时创建一个随机邮箱（含密码）
              </label>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => createMut.mutate(true)}
                disabled={createMut.isPending}
              >
                <Shuffle /> 随机
              </Button>
              <Button
                onClick={() => createMut.mutate(false)}
                disabled={!slug || createMut.isPending}
              >
                {createMut.isPending ? "创建中..." : "确认"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索 slug 或 domain..."
            className="pl-8"
          />
        </div>
        <div className="text-sm text-muted-foreground">共 {list.data?.total ?? 0} 个</div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>邮箱数</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">加载中...</TableCell>
              </TableRow>
            )}
            {list.data?.items.map((d) => (
              <TableRow key={d.domain_id}>
                <TableCell className="font-mono text-xs">{d.tenant_slug}</TableCell>
                <TableCell className="font-mono text-xs">{d.domain}</TableCell>
                <TableCell>
                  <Link
                    to={`/mailboxes?domain=${encodeURIComponent(d.domain)}`}
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {d.mailbox_count}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </TableCell>
                <TableCell>
                  {d.enabled ? (
                    <Badge variant="success">enabled</Badge>
                  ) : (
                    <Badge variant="secondary">disabled</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">{formatDate(d.created_at)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async () => {
                      const ok = await copyToClipboard(d.domain)
                      if (ok) toast.success("域名已复制")
                    }}
                  >
                    <Copy />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm(`确定删除 ${d.domain} 吗？\n将级联删除所有邮箱 + Maildir 数据 + Cloudflare MX 记录。`)) {
                        delMut.mutate(d.tenant_slug)
                      }
                    }}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {list.data && list.data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">暂无数据</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
