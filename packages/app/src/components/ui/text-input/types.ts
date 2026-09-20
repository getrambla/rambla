import type { TextInputProps } from "react-native";
import type { NativePastedFile } from "@/composer/native-pasted-image";

export interface EditingTextInputHandle {
  focus(): void;
  blur(): void;
  isFocused(): boolean;
  getText(): string;
  replaceText(text: string, selection?: { start: number; end: number }): void;
  /** Web only: an IME composition owns the field, so a programmatic write has to wait for it. */
  isComposing?(): boolean;
  /** Clear the editor and reset its intrinsic layout, preserving focus intent. */
  reset(): void;
  getNativeRef(): unknown;
}

export interface EditingTextInputProps extends Omit<
  TextInputProps,
  "defaultValue" | "onChangeText" | "value"
> {
  initialValue?: string;
  onChangeText?: (text: string) => void;
  onPasteImages?: (files: readonly NativePastedFile[]) => void;
  onPasteError?: (message: string) => void;
  variant?: "default" | "bottom-sheet";
}
