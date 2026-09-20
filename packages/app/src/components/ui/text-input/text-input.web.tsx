import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { TextInput } from "react-native";
import type { EditingTextInputHandle, EditingTextInputProps } from "./types";

interface WebTextInputElement extends TextInput {
  value?: string;
  setSelectionRange?: (start: number, end: number) => void;
  addEventListener(type: "compositionstart" | "compositionend", listener: EventListener): void;
  removeEventListener(type: "compositionstart" | "compositionend", listener: EventListener): void;
}

export const EditingTextInput = forwardRef<EditingTextInputHandle, EditingTextInputProps>(
  function EditingTextInputWeb(allProps, ref) {
    const {
      initialValue = "",
      onChangeText,
      onPasteImages: _,
      onPasteError: __,
      variant: ___,
      value: ____,
      defaultValue: _____,
      ...props
    } = allProps as EditingTextInputProps & { value?: unknown; defaultValue?: unknown };
    const inputRef = useRef<TextInput | null>(null);
    const initialTextRef = useRef(initialValue);
    const textRef = useRef(initialTextRef.current);
    const isComposingRef = useRef(false);
    const onChangeTextRef = useRef(onChangeText);
    onChangeTextRef.current = onChangeText;

    useEffect(() => {
      const input = inputRef.current as WebTextInputElement | null;
      if (!input) return;

      const startComposition = () => {
        isComposingRef.current = true;
      };
      const endComposition = () => {
        isComposingRef.current = false;
        const nextText = input.value ?? "";
        if (nextText === textRef.current) return;
        textRef.current = nextText;
        onChangeTextRef.current?.(nextText);
      };

      input.addEventListener("compositionstart", startComposition);
      input.addEventListener("compositionend", endComposition);
      return () => {
        input.removeEventListener("compositionstart", startComposition);
        input.removeEventListener("compositionend", endComposition);
      };
    }, []);

    const handleChangeText = useCallback((nextText: string) => {
      if (isComposingRef.current || nextText === textRef.current) return;
      textRef.current = nextText;
      onChangeTextRef.current?.(nextText);
    }, []);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      isFocused: () => document.activeElement === inputRef.current,
      getText: () => {
        const input = inputRef.current as WebTextInputElement | null;
        const nextText = input?.value ?? textRef.current;
        textRef.current = nextText;
        return nextText;
      },
      isComposing: () => isComposingRef.current,
      replaceText: (nextText, selection) => {
        // An IME composition owns the field until it ends; a write here would discard what the
        // user is composing. The caller re-issues it once the composition is over.
        if (isComposingRef.current) return;
        textRef.current = nextText;
        const input = inputRef.current as WebTextInputElement | null;
        if (input && "value" in input) input.value = nextText;
        if (selection && typeof input?.setSelectionRange === "function") {
          input.setSelectionRange(selection.start, selection.end);
        }
      },
      reset: () => {
        textRef.current = "";
        const input = inputRef.current as WebTextInputElement | null;
        if (input && "value" in input) input.value = "";
      },
      getNativeRef: () => inputRef.current,
    }));

    return (
      <TextInput
        {...props}
        ref={inputRef}
        defaultValue={initialTextRef.current}
        onChangeText={handleChangeText}
      />
    );
  },
);
