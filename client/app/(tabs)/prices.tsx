import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { Card, Input, Muted, useColors } from '@/components/ui';
import { pricesAt } from '@/lib/api';
import { rankProducts } from '@/lib/compare';
import { formatInr, formatMoney, formatVolume } from '@/lib/format';
import { useTrip } from '@/lib/trip';
import type { PriceRow, RankedProduct } from '@/lib/types';

export default function PricesScreen() {
  const c = useColors();
  const { airports } = useTrip();
  const iatas = airports.map((a) => a.iata);
  const key = iatas.join(',');
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    pricesAt(key ? key.split(',') : [])
      .then((r) => (setRows(r), setError(null)))
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [key]);

  useEffect(load, [load]);

  const ranked = useMemo(() => rankProducts(rows, { query }), [rows, query]);

  if (iatas.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.title}>No airports yet</Text>
        <Muted>Add the airports on your route first.</Muted>
        <Link href="/" style={{ color: c.tint, fontWeight: '600' }}>Go to My trip</Link>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={ranked}
      keyExtractor={(p) => String(p.productId)}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      ListHeaderComponent={
        <View style={{ gap: 8, backgroundColor: 'transparent' }}>
          <Text style={styles.title}>Cheapest on {iatas.join(' → ')}</Text>
          <Muted>All prices converted to INR at today's rates. Cheapest bottles first.</Muted>
          <Input value={query} onChangeText={setQuery} placeholder="Filter, e.g. Johnnie Walker or gin" />
          {error ? <Muted style={{ color: c.danger }}>{error}</Muted> : null}
          {loading && rows.length === 0 ? <ActivityIndicator /> : null}
        </View>
      }
      ListEmptyComponent={
        loading ? undefined : <Muted>No prices found for these airports yet. You can report one from the shelf.</Muted>
      }
      renderItem={({ item }) => <ProductCard product={item} />}
    />
  );
}

function ProductCard({ product }: { product: RankedProduct }) {
  const c = useColors();
  return (
    <Card>
      <Text style={styles.name}>
        {[product.brand, product.name].filter(Boolean).join(' ')}
        {volumeLabel(product) ? <Muted> {volumeLabel(product)}</Muted> : null}
      </Text>
      {product.savingInr ? (
        <Text style={{ color: c.tint, fontWeight: '600' }}>
          Save {formatInr(product.savingInr)} by buying at {product.best.airport_iata}
        </Text>
      ) : null}
      {product.offers.map((o, i) => (
        <Pressable
          key={o.airport_iata}
          disabled={!o.product_url}
          onPress={() => o.product_url && Linking.openURL(o.product_url)}
          style={[styles.offer, { backgroundColor: i === 0 ? c.best : 'transparent', borderColor: c.border }]}>
          <Text style={styles.airport}>{o.airport_iata}</Text>
          <View style={{ flex: 1, backgroundColor: 'transparent' }}>
            <Text style={{ fontWeight: i === 0 ? '700' : '400' }}>
              {o.price_inr != null ? formatInr(o.price_inr) : 'No INR rate yet'}
            </Text>
            <Muted>
              {formatMoney(o.price, o.currency)}
              {o.source === 'crowd' ? ` · reported by a traveller on ${o.observed_at.slice(0, 10)}` : ''}
            </Muted>
          </View>
          {i === 0 ? <Text style={{ color: c.tint, fontWeight: '700' }}>Cheapest</Text> : null}
        </Pressable>
      ))}
    </Card>
  );
}

/** Skip the size badge when the name already says it ("Black Label 1L"). */
function volumeLabel(p: RankedProduct) {
  const label = formatVolume(p.volumeMl);
  return label && !p.name.toLowerCase().replace(/\s/g, '').includes(label.toLowerCase()) ? label : '';
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  empty: { flex: 1, padding: 24, gap: 8, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700' },
  name: { fontSize: 16, fontWeight: '600' },
  offer: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  airport: { fontWeight: '700', width: 40 },
});
