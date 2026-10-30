import { NavLink } from "react-router-dom";
import { Box, GitBranch, Settings2 } from "lucide-react";
import { MultiStudioMark } from "./MultiStudioMark";
import { cn } from "@/lib/utils";

const items = [
  { to: "/workflow", label: "工作流", title: "节点工作流", icon: GitBranch },
  { to: "/models", label: "模型", title: "模型管理", icon: Box },
  { to: "/settings", label: "设置", title: "应用设置", icon: Settings2 },
] as const;

export function Sidebar() {
  return (
    <aside className="app-rail">
      <NavLink to="/" className="rail-brand" aria-label="MultiStudio 首页" title="MultiStudio">
        <MultiStudioMark size={28} />
      </NavLink>
      <nav aria-label="主导航" className="rail-navigation">
        {items.map(({ to, label, title, icon: Icon }) => (
          <NavLink key={to} to={to} end={to !== "/models"} title={title} className={({ isActive }) => cn("rail-link", isActive && "is-active")}>
            <Icon size={20} strokeWidth={1.65} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

export function CompactNavigation() {
  return (
    <nav aria-label="紧凑窗口导航" className="mobile-navigation">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to !== "/models"} className={({ isActive }) => cn("mobile-nav-link", isActive && "is-active")}>
          <Icon size={20} strokeWidth={1.7} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
