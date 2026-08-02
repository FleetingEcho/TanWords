import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
// Loaded here rather than through index.css: see the note there — an @import
// would put the @font-face url()s through Tailwind's inliner, which drops them.
import "./styles/fonts.css";
import "./styles/raw-markdown-editor.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={200}>
      <App />
    </TooltipProvider>
  </React.StrictMode>
);
