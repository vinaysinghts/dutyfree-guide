import { SymbolView } from 'expo-symbols';
import { usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';

import { useColors } from './ui';
import { stashCapture } from '@/lib/issueReport';
import { captureCurrentScreen } from '@/lib/screenshot';

/**
 * Header button on every screen. Takes the screenshot first, then opens the
 * report form, so the picture shows the problem rather than the form.
 */
export function ReportIssueButton() {
  const c = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    const uri = await captureCurrentScreen();
    stashCapture({ uri, screen: pathname });
    setBusy(false);
    router.push('/report-issue');
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Report a problem"
      hitSlop={10}
      style={({ pressed }) => ({ paddingHorizontal: 14, opacity: pressed ? 0.6 : 1 })}>
      {busy ? (
        <ActivityIndicator color={c.tint} />
      ) : (
        <SymbolView name={{ ios: 'ladybug', android: 'bug_report', web: 'bug_report' }} tintColor={c.tint} size={22} />
      )}
    </Pressable>
  );
}
