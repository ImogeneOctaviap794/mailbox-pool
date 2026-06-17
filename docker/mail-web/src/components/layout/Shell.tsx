import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { Gauge, Globe, Globe2, Mail, Inbox, FileCode2, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { clearToken } from "@/lib/api"

const nav = [
  { to: "/", label: "概览", icon: Gauge, end: true },
  { to: "/root-domains", label: "根域名", icon: Globe2, end: false },
  { to: "/domains", label: "域名", icon: Globe, end: false },
  { to: "/mailboxes", label: "邮箱", icon: Mail, end: false },
  { to: "/inbox", label: "收件箱", icon: Inbox, end: false },
  { to: "/docs", label: "API 文档", icon: FileCode2, end: false },
]

export function Shell() {
  const navigate = useNavigate()
  const logout = () => {
    clearToken()
    navigate("/login", { replace: true })
  }
  return (
    <div className="grid min-h-screen w-full md:grid-cols-[240px_1fr] bg-background">
      <aside className="sticky top-0 hidden h-screen border-r bg-card md:block">
        <div className="flex h-14 items-center gap-2 border-b px-6">
          <Mail className="h-5 w-5 text-primary" />
          <span className="font-semibold">Mail Pool</span>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 border-t p-3">
          <Button variant="ghost" size="sm" onClick={logout} className="w-full justify-start">
            <LogOut className="h-4 w-4" /> 退出
          </Button>
        </div>
      </aside>
      <main className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/90 px-6 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            <span className="font-semibold">Mail Pool</span>
          </div>
          <Button variant="ghost" size="icon" onClick={logout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex-1 p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
