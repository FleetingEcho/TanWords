import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FloatingBrowserPopoutApp } from "@/components/FloatingBrowser/FloatingBrowserPopoutApp";
// Same reasoning as main.tsx: an @import would put the @font-face url()s
// through Tailwind's inliner, which drops them.
import "./styles/fonts.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={200}>
      <FloatingBrowserPopoutApp />
    </TooltipProvider>
  </React.StrictMode>
);
