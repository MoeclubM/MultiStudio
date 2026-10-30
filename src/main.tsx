import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

document.documentElement.dataset.theme = localStorage.getItem("lt_theme") === "dark" ? "dark" : "light";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.multistudioDesktop ? <App /> : <p role="alert" className="p-8">请从 MultiStudio 桌面程序启动。</p>}
  </React.StrictMode>,
);
