import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

export function TopBar() {
  const link = (to: string, label: string) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
          isActive ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )
      }
    >
      {label}
    </NavLink>
  );

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/80 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <img src="/favicon.svg" alt="LiveTranslator" className="h-8 w-8 rounded-lg shadow-sm" width={32} height={32} />
        <div>
          <div className="text-sm font-semibold leading-none">LiveTranslator</div>
          <div className="text-xs text-muted-foreground">实时语音 · OpenAI 兼容</div>
        </div>
      </div>
      <nav className="flex items-center gap-1 rounded-full bg-muted p-1">
        {link("/", "实时")}
        {link("/settings", "设置")}
        {link("/history", "历史")}
      </nav>
    </header>
  );
}
