import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { searchAirports } from '@/lib/api';
import type { Airport } from '@/lib/types';
import { Text, View } from './Themed';
import { Input, Muted, useColors } from './ui';

/** Debounced airport search; calls onPick with the chosen airport. */
export function AirportSearch({ onPick, exclude = [], placeholder }: {
  onPick: (a: Airport) => void;
  exclude?: string[];
  placeholder?: string;
}) {
  const c = useColors();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Airport[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      searchAirports(query)
        .then((r) => !cancelled && (setResults(r), setError(null)))
        .catch((e) => !cancelled && setError(String(e.message ?? e)));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const visible = results.filter((a) => !exclude.includes(a.iata));

  return (
    <View style={{ gap: 6, backgroundColor: 'transparent' }}>
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder ?? 'Search city, airport or code (e.g. AMS)'}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Search airports"
      />
      {error ? <Muted style={{ color: c.danger }}>{error}</Muted> : null}
      {visible.map((a) => (
        <Pressable
          key={a.iata}
          onPress={() => {
            onPick(a);
            setQuery('');
          }}
          style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={styles.code}>{a.iata}</Text>
          <View style={{ flex: 1, backgroundColor: 'transparent' }}>
            <Text numberOfLines={1}>{a.name}</Text>
            <Muted>{[a.city, a.country_code].filter(Boolean).join(', ')}</Muted>
          </View>
          <Text style={{ color: c.tint, fontWeight: '600' }}>Add</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 10, padding: 10 },
  code: { fontWeight: '700', fontSize: 16, width: 44 },
});
