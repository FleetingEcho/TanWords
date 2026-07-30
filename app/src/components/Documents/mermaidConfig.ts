export interface MermaidThemeColors {
  background: string;
  card: string;
  foreground: string;
  border: string;
  primary: string;
}

export function createMermaidConfig(isDark: boolean, colors?: MermaidThemeColors) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    suppressErrorRendering: true,
    theme: isDark ? "dark" as const : "neutral" as const,
    ...(colors ? {
      themeVariables: {
        background: colors.background,
        primaryColor: colors.card,
        primaryTextColor: colors.foreground,
        primaryBorderColor: colors.border,
        secondaryColor: colors.background,
        tertiaryColor: colors.card,
        lineColor: colors.foreground,
        textColor: colors.foreground,
        mainBkg: colors.card,
        nodeBorder: colors.border,
        clusterBkg: colors.background,
        clusterBorder: colors.border,
        titleColor: colors.foreground,
        edgeLabelBackground: colors.background,
        actorBkg: colors.card,
        actorBorder: colors.border,
        actorTextColor: colors.foreground,
        signalColor: colors.foreground,
        labelBoxBkgColor: colors.card,
        labelBoxBorderColor: colors.border,
        labelTextColor: colors.foreground,
        activationBkgColor: colors.card,
        activationBorderColor: colors.primary,
      },
    } : {}),
  };
}
