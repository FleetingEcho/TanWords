/**
 * Shared UI primitives — the building blocks for every screen.
 *
 * Design rules (enforce everywhere, don't reinvent per screen):
 *  - All colors come from semantic tokens (bg-background, text-foreground,
 *    bg-card, text-muted-foreground, text-primary, border-border, …) which
 *    follow the active theme. Never hardcode hex/hsl colors in screens.
 *  - Touch targets ≥ 44px, pressables use `tapHaptic()` and opacity feedback.
 *  - Long lists → FlashList (perf), NOT ScrollView with .map.
 *  - Chinese-first: labels come from useT(), no inline strings that have keys.
 *  - Icon colors come from usePalette() (concrete hsl strings).
 *
 * Docs rule (AGENTS.md): https://docs.expo.dev/versions/v57.0.0/ is the
 * source of truth for SDK behavior.
 */
import React, { useEffect, useRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type RefreshControlProps,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { usePalette } from "@/lib/theme";

/** Fire-and-forget light haptic for any tap. Cheap, safe on all devices. */
export function tapHaptic() {
  void Haptics.selectionAsync().catch(() => {});
}

// ---------------------------------------------------------------------------
// Screen — consistent page shell: safe area, bg, optional scroll + padding.
// Header stays fixed while content scrolls (pass `header`).
// ---------------------------------------------------------------------------
export function Screen({
  children,
  header,
  scroll = true,
  padded = true,
  edges = ["top"],
  refreshControl,
}: {
  children: ReactNode;
  /** Fixed top area (title row, tabs, search) that does not scroll. */
  header?: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: Edge[];
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={edges}>
      {header}
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={padded ? "px-4 pb-8" : "pb-8"}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View className={"flex-1" + (padded ? " px-4" : "")}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/** Standard large title row used by every tab screen's header. */
export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View className="flex-row items-end justify-between px-4 pb-2 pt-3">
      <View className="flex-1 pr-3">
        <Text className="text-[28px] font-bold text-foreground">{title}</Text>
        {subtitle ? (
          <Text className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Card — white surface with hairline border (desktop's card look).
// ---------------------------------------------------------------------------
export function Card({
  children,
  className = "",
  onPress,
}: {
  children: ReactNode;
  className?: string;
  onPress?: (e: GestureResponderEvent) => void;
}) {
  const base = "rounded-2xl border border-border bg-card p-4";
  if (onPress) {
    return (
      <Pressable
        onPress={(e) => {
          tapHaptic();
          onPress(e);
        }}
        className={`${base} ${className}`}
        style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
      >
        {children}
      </Pressable>
    );
  }
  return <View className={`${base} ${className}`}>{children}</View>;
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="mb-2 mt-5 flex-row items-center justify-between">
      <Text className="text-[17px] font-semibold text-foreground">{title}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={() => {
            tapHaptic();
            onAction();
          }}
          hitSlop={8}
        >
          <Text className="text-[14px] text-primary">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Badge — count pill (review due count etc.) or small dot.
// ---------------------------------------------------------------------------
export function Badge({
  count,
  tone = "primary",
}: {
  count: number;
  tone?: "primary" | "destructive" | "muted";
}) {
  if (!count || count <= 0) return null;
  const bg =
    tone === "primary" ? "bg-primary" : tone === "destructive" ? "bg-destructive" : "bg-muted";
  const fg = tone === "muted" ? "text-muted-foreground" : "text-primary-foreground";
  return (
    <View className={`min-w-[20px] items-center rounded-full px-1.5 py-0.5 ${bg}`}>
      <Text className={`text-[11px] font-bold ${fg}`}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Button — variants match desktop intent; min height 44 (Apple HIG).
// ---------------------------------------------------------------------------
export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  className = "",
}: {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  const p = usePalette();
  const styles: Record<string, string> = {
    primary: "bg-primary",
    secondary: "bg-secondary",
    ghost: "bg-transparent",
    destructive: "bg-destructive",
  };
  const textStyles: Record<string, string> = {
    primary: "text-primary-foreground",
    secondary: "text-secondary-foreground",
    ghost: "text-primary",
    destructive: "text-destructive-foreground",
  };
  const sizes = { sm: "min-h-[36px] px-3", md: "min-h-[44px] px-4", lg: "min-h-[52px] px-5" };
  const fontSizes = { sm: "text-[13px]", md: "text-[15px]", lg: "text-[17px]" };
  const spinnerColor =
    variant === "primary" || variant === "destructive" ? p["primary-foreground"] : p.primary;
  const off = disabled || loading;
  return (
    <Pressable
      disabled={off}
      onPress={() => {
        tapHaptic();
        onPress?.();
      }}
      className={`flex-row items-center justify-center gap-2 rounded-xl ${styles[variant]} ${sizes[size]} ${
        off ? "opacity-50" : ""
      } ${className}`}
      style={({ pressed }) => (pressed && !off ? { opacity: 0.85 } : undefined)}
    >
      {loading ? <ActivityIndicator size="small" color={spinnerColor} /> : icon}
      <Text className={`font-semibold ${fontSizes[size]} ${textStyles[variant]}`}>
        {loading ? "…" : title}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// ListRow — the standard tappable row (title + subtitle + chevron).
// ---------------------------------------------------------------------------
export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  showChevron = true,
  titleClassName = "",
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  titleClassName?: string;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              tapHaptic();
              onPress();
            }
          : undefined
      }
      className="min-h-[52px] flex-row items-center gap-3 px-4 py-2.5"
      style={({ pressed }) => (pressed && onPress ? { backgroundColor: p.muted } : undefined)}
    >
      {left}
      <View className="flex-1">
        <Text className={`text-[15px] font-medium text-foreground ${titleClassName}`} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-0.5 text-[13px] text-muted-foreground" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress && showChevron ? (
        <Ionicons name="chevron-forward" size={16} color={p["muted-foreground"]} />
      ) : null}
    </Pressable>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <View className={`h-px bg-border ${className}`} />;
}

// ---------------------------------------------------------------------------
// EmptyState — icon + title + hint + optional CTA. Every empty list gets one.
// ---------------------------------------------------------------------------
export function EmptyState({
  icon,
  title,
  hint,
  actionTitle,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
  actionTitle?: string;
  onAction?: () => void;
}) {
  const p = usePalette();
  return (
    <View className="items-center px-6 py-12">
      <View className="mb-3 rounded-full bg-muted p-4">
        <Ionicons name={icon} size={28} color={p["muted-foreground"]} />
      </View>
      <Text className="text-center text-[16px] font-semibold text-foreground">{title}</Text>
      {hint ? (
        <Text className="mt-1.5 text-center text-[13px] leading-5 text-muted-foreground">
          {hint}
        </Text>
      ) : null}
      {actionTitle && onAction ? (
        <Button title={actionTitle} onPress={onAction} variant="secondary" size="sm" className="mt-4" />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// StatTile — dashboard metric (value + label).
// ---------------------------------------------------------------------------
export function StatTile({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value: ReactNode;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}) {
  const p = usePalette();
  return (
    <Card className="flex-1 p-3.5" onPress={onPress}>
      {icon ? <Ionicons name={icon} size={18} color={p.primary} /> : null}
      <Text className="mt-1.5 text-[22px] font-bold text-foreground">{value}</Text>
      <Text className="mt-0.5 text-[12px] text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SearchBar — tinted input with icon + clear button.
// ---------------------------------------------------------------------------
export function SearchBar({
  value,
  onChangeText,
  placeholder,
  autoFocus = false,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const p = usePalette();
  return (
    <View className="mx-4 mb-2 flex-row items-center rounded-xl bg-muted px-3" style={{ height: 40 }}>
      <Ionicons name="search" size={16} color={p["muted-foreground"]} />
      <TextInput
        className="ml-2 flex-1 text-[15px] text-foreground"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p["muted-foreground"]}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing" // iOS native clear button
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// SegmentedTabs — top pill switcher (Articles / Podcasts / HN / Bookmarks …).
// ---------------------------------------------------------------------------
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string; badgeCount?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View className="flex-row gap-1 rounded-xl bg-muted p-1">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => {
              if (!active) {
                tapHaptic();
                onChange(o.key);
              }
            }}
            className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-1.5 ${
              active ? "bg-card" : ""
            }`}
            style={active ? { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : undefined}
          >
            <Text
              className={`text-[13px] ${
                active ? "font-semibold text-foreground" : "text-muted-foreground"
              }`}
            >
              {o.label}
            </Text>
            {o.badgeCount ? <Badge count={o.badgeCount} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton — shimmering placeholder while queries load. Compose freely.
// ---------------------------------------------------------------------------
export function Skeleton({ className = "" }: { className?: string }) {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View className={`rounded-lg bg-muted ${className}`} style={{ opacity }} />;
}

/** Full-screen loading state — use while the first query is in flight. */
export function LoadingView({ label }: { label?: string }) {
  const p = usePalette();
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator size="large" color={p.primary} />
      {label ? <Text className="mt-3 text-[13px] text-muted-foreground">{label}</Text> : null}
    </View>
  );
}
