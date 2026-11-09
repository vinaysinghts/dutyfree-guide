import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, type TextInputProps, type ViewStyle } from 'react-native';

import { Text, View, useThemeColor } from './Themed';

export function useColors() {
  return {
    text: useThemeColor({}, 'text'),
    muted: useThemeColor({}, 'muted'),
    card: useThemeColor({}, 'card'),
    border: useThemeColor({}, 'border'),
    tint: useThemeColor({}, 'tint'),
    onTint: useThemeColor({}, 'onTint'),
    best: useThemeColor({}, 'best'),
    warn: useThemeColor({}, 'warn'),
    danger: useThemeColor({}, 'danger'),
  };
}

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Card({ children, style, highlight }: { children: ReactNode; style?: ViewStyle; highlight?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.card, { backgroundColor: highlight ? c.best : c.card, borderColor: c.border }, style]}>
      {children}
    </View>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  const c = useColors();
  return <Text style={[{ color: c.muted, fontSize: 13 }, style]}>{children}</Text>;
}

export function Button({
  title, onPress, variant = 'primary', disabled, busy,
}: { title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; busy?: boolean }) {
  const c = useColors();
  const bg = variant === 'primary' ? c.tint : variant === 'danger' ? c.danger : 'transparent';
  const fg = variant === 'ghost' ? c.tint : c.onTint;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === 'ghost' ? c.border : bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600' }}>{title}</Text>}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string }) {
  const c = useColors();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 4, backgroundColor: 'transparent' }}>
      {label ? <Muted>{label}</Muted> : null}
      <TextInput
        placeholderTextColor={c.muted}
        style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }, style]}
        {...rest}
      />
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? c.tint : c.border, backgroundColor: selected ? c.tint : c.card }]}>
      <Text style={{ color: selected ? c.onTint : c.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
  button: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
});
