import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Plus, Trash2, Pencil, Star, ShieldCheck, ShieldAlert, Loader2, KeyRound,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, type CfVerifyResult, type CfZone, type RootDomain } from "@/lib/api"
import { formatDate } from "@/lib/utils"

type DialogMode = { kind: "create" } | { kind: "edit"; row: RootDomain } | null

export function RootDomains() {
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<DialogMode>(null)
  const [delTarget, setDelTarget] = useState<RootDomain | null>(null)

  const roots = useQuery({
    queryKey: ["root-domains"],
    queryFn: () => api.listRootDomains(),
  })

  const items = roots.data?.items ?? []
  const mailHost = roots.data?.mail_hostname ?? ""

  const setDefaultMut = useMutation({
    mutationFn: (root: string) => api.updateRootDomain(root, { set_default: true }),
    onSuccess: (_, root) => {
      toast.success("已设为默认根域名", { description: root })
      qc.invalidateQueries({ queryKey: ["root-domains"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
    onError: (e: Error) => toast.error("设置失败", { description: e.message }),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">根域名</h1>
          <p className="text-sm text-muted-foreground">
            管理可用的根域名与各自的 Cloudflare 凭证。新建子域名时按所属根自动写入 MX
            {mailHost && (
              <> 记录到 <code className="rounded bg-muted px-1 py-0.5 text-xs tabular-nums">{mailHost}</code></>
            )}
          </p>
        </div>
        <Button onClick={() => setDialog({ kind: "create" })}>
          <Plus /> 新增根域名
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>根域名</TableHead>
              <TableHead>Zone ID</TableHead>
              <TableHead>CF Token</TableHead>
              <TableHead>备注</TableHead>
              <TableHead className="text-right tabular-nums">子域数</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roots.isLoading &&
              Array.from({ length: 2 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7} className="py-4">
                    <div className="h-5 w-full animate-pulse rounded bg-muted" />
                  </TableCell>
                </TableRow>
              ))}

            {items.map((r) => (
              <TableRow key={r.root_domain} className="group">
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {r.root_domain}
                    {r.is_default && (
                      <Badge variant="success" className="gap-1">
                        <Star className="h-3 w-3 fill-current" /> 默认
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                  {r.zone_id ? r.zone_id.slice(0, 10) + "…" : <span className="italic">未配置</span>}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {r.uses_global_token ? (
                    <span className="text-muted-foreground">全局 {r.token_masked}</span>
                  ) : r.token_masked ? (
                    r.token_masked
                  ) : (
                    <span className="italic text-muted-foreground">无</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.label || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.domain_count ?? 0}</TableCell>
                <TableCell>
                  {r.dns_enabled ? (
                    <Badge variant="secondary" className="gap-1 text-emerald-400">
                      <ShieldCheck className="h-3 w-3" /> 可自动建 MX
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1 text-amber-400">
                      <ShieldAlert className="h-3 w-3" /> DNS 未配置
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                    {!r.is_default && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="设为默认"
                        onClick={() => setDefaultMut.mutate(r.root_domain)}
                        disabled={setDefaultMut.isPending}
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" title="编辑" onClick={() => setDialog({ kind: "edit", row: r })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="删除" onClick={() => setDelTarget(r)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}

            {roots.data && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <div className="space-y-2 text-muted-foreground">
                    <KeyRound className="mx-auto h-8 w-8 opacity-40" />
                    <p>还没有配置任何根域名</p>
                    <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "create" })}>
                      <Plus /> 新增第一个
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {dialog && (
        <RootDomainDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            qc.invalidateQueries({ queryKey: ["root-domains"] })
            qc.invalidateQueries({ queryKey: ["stats"] })
          }}
        />
      )}

      {delTarget && (
        <DeleteRootDialog
          row={delTarget}
          onClose={() => setDelTarget(null)}
          onDeleted={() => {
            setDelTarget(null)
            qc.invalidateQueries({ queryKey: ["root-domains"] })
            qc.invalidateQueries({ queryKey: ["stats"] })
            qc.invalidateQueries({ queryKey: ["domains"] })
          }}
        />
      )}
    </div>
  )
}

function RootDomainDialog({
  mode,
  onClose,
  onSaved,
}: {
  mode: Exclude<DialogMode, null>
  onClose: () => void
  onSaved: () => void
}) {
  const editing = mode.kind === "edit"
  const row = editing ? mode.row : undefined

  const [rootDomain, setRootDomain] = useState(row?.root_domain ?? "")
  const [zoneId, setZoneId] = useState(row?.zone_id ?? "")
  const [token, setToken] = useState("")
  const [label, setLabel] = useState(row?.label ?? "")
  const [isDefault, setIsDefault] = useState(row?.is_default ?? false)
  const [verify, setVerify] = useState<CfVerifyResult | null>(null)
  const [zones, setZones] = useState<CfZone[] | null>(null)
  // create -> zone-picker by default; edit -> manual fields
  const [manual, setManual] = useState(editing)

  const zonesMut = useMutation({
    mutationFn: () => api.listCfZones({ cf_token: token.trim() || undefined }),
    onSuccess: (r) => {
      if (r.ok && r.zones) {
        setZones(r.zones)
        toast.success(`拉取到 ${r.count} 个域名`, {
          description: token.trim() ? undefined : "使用全局 CF Token",
        })
      } else {
        toast.error("拉取域名失败", { description: r.detail || "该 Token 缺少 Zone:Read 权限" })
      }
    },
    onError: (e: Error) => toast.error("拉取请求失败", { description: e.message }),
  })

  const pickZone = (zid: string) => {
    const z = zones?.find((x) => x.zone_id === zid)
    if (z) {
      setZoneId(z.zone_id)
      setRootDomain(z.name)
    }
  }

  const verifyMut = useMutation({
    mutationFn: () => api.verifyRootDomain({ zone_id: zoneId.trim(), cf_token: token.trim() || undefined }),
    onSuccess: (r) => {
      setVerify(r)
      if (r.ok) toast.success("Cloudflare 校验通过", { description: `zone: ${r.zone_name}` })
      else toast.error("校验失败", { description: r.detail || "token 或 zone_id 不匹配" })
    },
    onError: (e: Error) => toast.error("校验请求失败", { description: e.message }),
  })

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        zone_id: zoneId.trim(),
        cf_token: token.trim() || undefined,
        label: label.trim(),
        set_default: isDefault,
        verify: false,
      }
      return editing
        ? api.updateRootDomain(row!.root_domain, body)
        : api.createRootDomain({ root_domain: rootDomain.trim().toLowerCase(), ...body })
    },
    onSuccess: () => {
      toast.success(editing ? "已更新" : "根域名已新增")
      onSaved()
    },
    onError: (e: Error) => toast.error("保存失败", { description: e.message }),
  })

  const canSave = (editing || /^[a-z0-9.-]+\.[a-z]{2,}$/.test(rootDomain.trim().toLowerCase())) && zoneId.trim().length > 0

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `编辑 ${row!.root_domain}` : "新增根域名"}</DialogTitle>
          <DialogDescription>
            每个根域名绑定自己的 Cloudflare Zone ID + API Token，支持多个 CF 账号混管。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* CF API Token — always first; drives both auto-fetch and manual verify */}
          <div className="space-y-1.5">
            <Label>CF API Token {editing && <span className="text-muted-foreground">（留空不修改）</span>}</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={editing ? "••••••••（保留原值）" : "留空则用全局 CF_API_TOKEN"}
                className="font-mono text-xs"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value)
                  setVerify(null)
                  setZones(null)
                }}
              />
              {!manual && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => zonesMut.mutate()}
                  disabled={zonesMut.isPending}
                >
                  {zonesMut.isPending ? <Loader2 className="animate-spin" /> : "拉取域名"}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              需 <code className="rounded bg-muted px-1">Zone:Read</code> 权限；留空则用全局 Token 拉取
            </p>
          </div>

          {!manual ? (
            /* ---- Zone picker mode (recommended) ---- */
            <div className="space-y-1.5">
              <Label>选择根域名</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                value={zoneId}
                disabled={!zones}
                onChange={(e) => pickZone(e.target.value)}
              >
                <option value="">{zones ? "— 请选择 —" : "请先点「拉取域名」"}</option>
                {zones?.map((z) => (
                  <option key={z.zone_id} value={z.zone_id} disabled={z.already_added}>
                    {z.name}
                    {z.already_added ? "（已添加）" : z.status !== "active" ? `（${z.status}）` : ""}
                  </option>
                ))}
              </select>
              {rootDomain && zoneId && (
                <p className="text-xs text-emerald-400">
                  ✓ {rootDomain} · zone {zoneId.slice(0, 10)}…
                </p>
              )}
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setManual(true)}
              >
                改为手动输入 Zone ID
              </button>
            </div>
          ) : (
            /* ---- Manual mode (fallback / editing) ---- */
            <>
              <div className="space-y-1.5">
                <Label>根域名</Label>
                <Input
                  placeholder="例如：example.com"
                  value={rootDomain}
                  disabled={editing}
                  onChange={(e) => setRootDomain(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Zone ID</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => verifyMut.mutate()}
                    disabled={!zoneId.trim() || verifyMut.isPending}
                  >
                    {verifyMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "验证配对"}
                  </Button>
                </div>
                <Input
                  placeholder="Cloudflare Zone ID"
                  className="font-mono text-xs"
                  value={zoneId}
                  onChange={(e) => {
                    setZoneId(e.target.value)
                    setVerify(null)
                  }}
                />
                {verify && (
                  <p className={`text-xs ${verify.ok ? "text-emerald-400" : "text-destructive"}`}>
                    {verify.ok ? `✓ zone: ${verify.zone_name}` : `✗ ${verify.detail || "token 与 zone 不匹配"}`}
                  </p>
                )}
                {!editing && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => setManual(false)}
                  >
                    ← 改回从 Token 拉取域名
                  </button>
                )}
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>备注</Label>
            <Input placeholder="例如：CF 账号 #1" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            设为默认根域名（新建子域名时默认选中）
          </label>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={!canSave || saveMut.isPending}>
            {saveMut.isPending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteRootDialog({
  row,
  onClose,
  onDeleted,
}: {
  row: RootDomain
  onClose: () => void
  onDeleted: () => void
}) {
  const [confirmText, setConfirmText] = useState("")
  const hasSubs = (row.domain_count ?? 0) > 0

  const delMut = useMutation({
    mutationFn: () => api.deleteRootDomain(row.root_domain, hasSubs),
    onSuccess: (r) => {
      toast.success("根域名已删除", {
        description: r.purged_subdomains.length
          ? `级联删除 ${r.purged_subdomains.length} 个子域名`
          : undefined,
      })
      onDeleted()
    },
    onError: (e: Error) => toast.error("删除失败", { description: e.message }),
  })

  const confirmed = !hasSubs || confirmText.trim().toLowerCase() === row.root_domain.toLowerCase()

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除根域名 {row.root_domain}</DialogTitle>
          <DialogDescription>
            {hasSubs ? (
              <>
                该根域名下还有 <b className="text-destructive">{row.domain_count}</b> 个子域名。删除将
                <b> 级联清除所有子域名、邮箱、Maildir 数据以及对应的 Cloudflare MX 记录</b>，不可恢复。
              </>
            ) : (
              "该根域名下没有子域名，可以安全删除。"
            )}
          </DialogDescription>
        </DialogHeader>

        {hasSubs && (
          <div className="space-y-1.5">
            <Label>
              请输入 <code className="rounded bg-muted px-1">{row.root_domain}</code> 以确认
            </Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={row.root_domain}
              autoFocus
            />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={() => delMut.mutate()}
            disabled={!confirmed || delMut.isPending}
          >
            {delMut.isPending ? "删除中..." : hasSubs ? "级联删除" : "删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
