import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AgeGate } from '@/components/AgeGate';
import { ReportIssueButton } from '@/components/ReportIssueButton';
import { useColorScheme } from '@/components/useColorScheme';
import { installDiagnostics } from '@/lib/diagnostics';
import { TravelDayProvider } from '@/lib/travelDay';
import { TripProvider } from '@/lib/trip';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = { anchor: '(tabs)' };

// Remember recent errors so problem reports can include them (lib/diagnostics.ts).
installDiagnostics();

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({ SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf') });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AgeGate>
        <TripProvider>
          <TravelDayProvider>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="review" options={{ title: 'Review price reports', headerRight: () => <ReportIssueButton /> }} />
              <Stack.Screen name="report-issue" options={{ title: 'Report a problem', presentation: 'modal' }} />
            </Stack>
          </TravelDayProvider>
        </TripProvider>
      </AgeGate>
    </ThemeProvider>
  );
}
