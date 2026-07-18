export function createMermaidConfig(isDark: boolean) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    suppressErrorRendering: true,
    theme: isDark ? "dark" as const : "neutral" as const,
  };
}
