import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { Button, Card, Input, Muted, useColors } from '@/components/ui';
import { pendingSubmissions, photoUrl, reviewSubmission, updateSubmission } from '@/lib/api';
import type { LocationCheck, Submission } from '@/lib/types';

/** Admin-only queue. RLS hides other people's reports from non-admins, so this is empty for them. */
export default function ReviewScreen() {
  const c = useColors();
  const [items, setItems] = useState<Submission[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    pendingSubmissions().then(setItems).catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  const done = (id: number) => setItems((list) => list.filter((s) => s.id !== id));

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(s) => String(s.id)}
      ListHeaderComponent={error ? <Muted style={{ color: c.danger }}>{error}</Muted> : undefined}
      ListEmptyComponent={<Muted>No reports waiting for review.</Muted>}
      renderItem={({ item }) => <ReviewCard item={item} onDone={() => done(item.id)} onError={setError} />}
    />
  );
}

function ReviewCard({ item, onDone, onError }: { item: Submission; onDone: () => void; onError: (e: string) => void }) {
  const c = useColors();
  const [productName, setProductName] = useState(item.product_name ?? '');
  const [brand, setBrand] = useState(item.brand ?? '');
  const [volume, setVolume] = useState(item.volume_ml ? String(item.volume_ml) : '');
  const [price, setPrice] = useState(item.price != null ? String(item.price) : '');
  const [currency, setCurrency] = useState(item.currency ?? '');
  const [showOcr, setShowOcr] = useState(false);
  const [busy, setBusy] = useState(false);

  const complete = productName.trim().length >= 2 && Number(price) > 0 && /^[A-Z]{3}$/.test(currency);

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      if (approve) {
        await updateSubmission(item.id, {
          product_name: productName.trim(),
          brand: brand.trim() || null,
          volume_ml: volume ? Number(volume) : null,
          price: Number(price.replace(',', '.')),
          currency,
        });
      }
      await reviewSubmission(item.id, approve);
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={{ fontWeight: '700' }}>{item.airport_iata} · reported {item.created_at.slice(0, 10)}</Text>
      <LocationVerdict check={item.location_check} km={item.distance_km} source={item.location_source} />
      {item.photo_taken_at ? <Muted>Photo taken {item.photo_taken_at.slice(0, 16).replace('T', ' ')}</Muted> : null}
      {item.photo_path ? <SubmissionPhoto path={item.photo_path} /> : null}
      {item.ocr_text ? (
        <Pressable onPress={() => setShowOcr((v) => !v)}>
          <Text style={{ color: c.tint }}>{showOcr ? 'Hide' : 'Show'} text read from the photo</Text>
          {showOcr ? <Muted style={styles.ocr}>{item.ocr_text}</Muted> : null}
        </Pressable>
      ) : null}
      {item.note ? <Muted>Note: {item.note}</Muted> : null}

      <Input label="Product" value={productName} onChangeText={setProductName} />
      <Input label="Brand" value={brand} onChangeText={setBrand} />
      <View style={styles.row}>
        <View style={styles.flex}><Input label="Size (ml)" value={volume} onChangeText={setVolume} keyboardType="number-pad" /></View>
        <View style={styles.flex}><Input label="Price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" /></View>
        <View style={styles.flex}><Input label="Currency" value={currency} onChangeText={(t) => setCurrency(t.toUpperCase())} autoCapitalize="characters" maxLength={3} /></View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}><Button title="Approve" onPress={() => decide(true)} disabled={!complete} busy={busy} /></View>
        <View style={styles.flex}><Button title="Reject" variant="danger" onPress={() => decide(false)} busy={busy} /></View>
      </View>
    </Card>
  );
}

function LocationVerdict({ check, km, source }: { check: LocationCheck; km: number | null; source: Submission['location_source'] }) {
  const c = useColors();
  const how = source === 'device' ? 'phone GPS' : source === 'exif' ? 'photo GPS' : '';
  const text: Record<LocationCheck, [string, string]> = {
    at_airport: [`✓ Taken at the airport (${how})`, c.tint],
    near: [`⚠ Taken ${km} km from the airport (${how})`, c.warn],
    far: [`✕ Taken ${km} km away from the airport (${how})`, c.danger],
    unknown: ['? No location: check the photo carefully', c.muted],
  };
  const [label, color] = text[check];
  return <Text style={{ color, fontWeight: '600' }}>{label}</Text>;
}

function SubmissionPhoto({ path }: { path: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    photoUrl(path).then(setUri).catch(() => {});
  }, [path]);
  return uri ? <Image source={{ uri }} style={styles.photo} resizeMode="contain" /> : null;
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', gap: 8, backgroundColor: 'transparent' },
  flex: { flex: 1, backgroundColor: 'transparent' },
  photo: { width: '100%', height: 260, borderRadius: 8 },
  ocr: { fontFamily: 'SpaceMono', fontSize: 12, marginTop: 4 },
});
