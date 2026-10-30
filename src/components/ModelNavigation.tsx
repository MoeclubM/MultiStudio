import { NavLink } from "react-router-dom";
import { Compass, Box, Download, AudioLines } from "lucide-react";
import { useHubStore } from "@/stores/hub";
export function ModelNavigation() {
  const count = useHubStore(s => s.jobs.filter(j => ["queued", "downloading", "verifying"].includes(j.status)).length);
  return <nav className="model-navigation" aria-label="模型管理导航">
    <NavLink to="/models" end><Box size={15} />我的模型</NavLink>
    <NavLink to="/models/speech"><AudioLines size={15} />语音模型</NavLink>
    <NavLink to="/models/discover"><Compass size={15} />发现模型</NavLink>
    <NavLink to="/models/downloads"><Download size={15} />下载任务{count > 0 && <span>{count}</span>}</NavLink>
  </nav>;
}
