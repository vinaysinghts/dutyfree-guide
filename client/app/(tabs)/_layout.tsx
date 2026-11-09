import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

type IconName = Parameters<typeof SymbolView>[0]['name'];

const icon = (name: IconName) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <SymbolView name={name} tintColor={color as string} size={26} />;
  };

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        headerShown: useClientOnlyValue(false, true),
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'My trip', tabBarIcon: icon({ ios: 'airplane', android: 'flight', web: 'flight' }) }}
      />
      <Tabs.Screen
        name="prices"
        options={{ title: 'Prices', tabBarIcon: icon({ ios: 'list.number', android: 'format_list_numbered', web: 'format_list_numbered' }) }}
      />
      <Tabs.Screen
        name="report"
        options={{ title: 'Report a price', tabBarIcon: icon({ ios: 'plus.circle', android: 'add_circle', web: 'add_circle' }) }}
      />
    </Tabs>
  );
}
