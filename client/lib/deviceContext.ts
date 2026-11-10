import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { Dimensions, Platform } from 'react-native';

import { recentLogs } from './diagnostics';
import type { IssueContext } from './issueReport';
import { isDemoMode } from './supabase';

/** What a developer needs to reproduce a problem. No ids, no location. */
export function collectContext(screen: string | undefined, tripIatas: string[]): IssueContext {
  const { width, height } = Dimensions.get('window');
  const consts = (Platform.constants ?? {}) as { Brand?: string; Model?: string; systemName?: string };
  const model = [consts.Brand, consts.Model].filter(Boolean).join(' ') || undefined;
  let locale: string | undefined;
  try {
    locale = Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    locale = undefined;
  }
  return {
    app: {
      version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version,
      build: Application.nativeBuildVersion ?? undefined,
      demo: isDemoMode,
    },
    device: {
      platform: Platform.OS,
      os_version: Platform.OS === 'web' ? (globalThis.navigator?.userAgent ?? undefined) : String(Platform.Version),
      model,
      screen: `${Math.round(width)}x${Math.round(height)}`,
      locale,
    },
    screen,
    trip: tripIatas,
    recent_logs: recentLogs(),
  };
}
