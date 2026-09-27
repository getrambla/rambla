export { ComposerDockBackground } from "./internal/background";
import { ScrollView } from "@/components/ui/scroll-view";
import type { ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { HEADER_INNER_HEIGHT, MAX_CONTENT_WIDTH } from "@/constants/layout";

interface ComposerDockProps {
  children: [ReactNode, ReactNode, ReactNode?];
  centered?: boolean;
}

export function ComposerDock({
  children: [content, composer, overlay],
  centered = false,
}: ComposerDockProps) {
  if (centered) {
    return (
      <View style={styles.centered}>
        <View style={styles.form}>
          <ScrollView style={styles.setup} keyboardShouldPersistTaps="handled">
            {content}
          </ScrollView>
          <View style={styles.centeredComposer}>{composer}</View>
          {overlay}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.surface}>
      <View style={styles.content}>{content}</View>
      <View style={styles.composer}>{composer}</View>
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, overflow: "hidden" },
  content: { flex: 1, justifyContent: "flex-end" },
  composer: {
    width: "100%",
    flexShrink: 1,
    // RAMBLA-FORK: fix: 2026-09-24-feat-user-adjustable-composer-height.md: bottom-anchor the composer stack so height growth pushes the top edge up.
    justifyContent: "flex-end",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: HEADER_INNER_HEIGHT + 24,
  },
  form: { flexShrink: 1, width: "100%", maxWidth: MAX_CONTENT_WIDTH },
  centeredComposer: { flexShrink: 0 },
  setup: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
});
