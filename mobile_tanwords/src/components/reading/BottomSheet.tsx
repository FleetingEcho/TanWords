/**
 * BottomSheet — the reading feature's own sheet shell (ui.tsx has none and is
 * locked). Implements the doc'd pattern: RN Modal + bottom-anchored card,
 * rounded top, backdrop tap to dismiss, SafeArea bottom padding.
 */
import React, { type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "@/lib/theme";
import { tapHaptic } from "@/components/ui";

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  /** Max height as a fraction of the screen — the sheet never covers the top. */
  maxHeightPercent = 0.86,
}: {
  visible: boolean;
  onClose?: () => void;
  title?: string;
  children: ReactNode;
  maxHeightPercent?: number;
}) {
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const { height } = useWindowDimensions();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        className="flex-1 justify-end"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          className="absolute inset-0"
          style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
          onPress={() => {
            if (onClose) {
              tapHaptic();
              onClose();
            }
          }}
        />
        <View
          className="rounded-t-3xl bg-background"
          style={{
            paddingBottom: Math.max(insets.bottom, 12),
            maxHeight: height * maxHeightPercent,
          }}
        >
          <View className="items-center pt-2.5 pb-1">
            <View className="h-1 w-9 rounded-full" style={{ backgroundColor: p.border }} />
          </View>
          {title ? (
            <Text className="px-5 pb-2 pt-1 text-[17px] font-semibold text-foreground">{title}</Text>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
