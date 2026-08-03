import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import { SplashScreen } from "@/components/Layout/SplashScreen";
// Loaded here rather than through index.css: see the note there — an @import
// would put the @font-face url()s through Tailwind's inliner, which drops them.
import "./styles/fonts.css";
import "./styles/raw-markdown-editor.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={200}>
      {/* Above App rather than in place of it: the auth check, the lock-state
          probe and the first page's chunk all run underneath while it shows. */}
      <SplashScreen />
      <App />
    </TooltipProvider>
  </React.StrictMode>
);
