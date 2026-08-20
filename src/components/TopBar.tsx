import { NavLink } from "react-router-dom";

export function TopBar() {
  const link = (to: string, label: string) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-full px-3.5 py-1.5 text-sm font-medium transition ${isActive ? "bg-white text-zinc-900" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"}`
      }
    >
      {label}
    </NavLink>
  );

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-zinc-800 bg-[#0F1117]/80 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">译</div>
        <div>
          <div className="text-sm font-semibold leading-none">LiveTranslator</div>
          <div className="text-xs text-zinc-500">实时语音 · OpenAI 兼容</div>
        </div>
      </div>
      <nav className="flex items-center gap-1 rounded-full bg-zinc-900 p-1">
        {link("/", "实时")}
        {link("/settings", "设置")}
        {link("/history", "历史")}
      </nav>
    </header>
  );
}
