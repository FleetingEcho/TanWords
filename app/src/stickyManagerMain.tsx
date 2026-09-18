import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StickyManagerApp } from "@/components/Sticky/StickyManagerApp";
// Same reasoning as main.tsx: an @import would put the @font-face url()s
// through Tailwind's inliner, which drops them.
import "./styles/fonts.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={200}>
      <StickyManagerApp />
    </TooltipProvider>
  </React.StrictMode>
);
