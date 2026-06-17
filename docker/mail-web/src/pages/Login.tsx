import { FormEvent, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Mail } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, setToken } from "@/lib/api"

export function Login() {
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: { pathname?: string } } }
  const from = location.state?.from?.pathname ?? "/"
  const [token, setTokenInput] = useState("")
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    setLoading(true)
    setToken(token.trim())
    try {
      await api.verifyToken()
      toast.success("登录成功")
      navigate(from, { replace: true })
    } catch (err) {
      setToken("")
      toast.error("Token 无效", { description: String((err as Error).message) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/10 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Mail Pool Console</CardTitle>
          <CardDescription>使用 Admin API Token 登录</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">Admin API Token</Label>
              <Input
                id="token"
                type="password"
                placeholder="Bearer Token"
                value={token}
                onChange={(e) => setTokenInput(e.target.value)}
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground">
                存储在本地 localStorage，仅你本人可见。
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "验证中..." : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
