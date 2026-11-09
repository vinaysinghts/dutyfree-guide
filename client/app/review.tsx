import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { Button, Card, Muted, useColors } from '@/components/ui';
import { pendingSubmissions, photoUrl, reviewSubmission } from '@/lib/api';
import { formatMoney, formatVolume } from '@/lib/format';
import type { Submission } from '@/lib/types';

/** Admin-only queue. RLS hides other people's reports from non-admins, so this is empty for them. */
export default function ReviewScreen() {
  const c = useColors();
  const [items, setItems] = useState<Submission[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    pendingSubmissions().then(setItems).catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  const decide = async (id: number, approve: boolean) => {
    try {
      await reviewSubmission(id, approve);
      setItems((list) => list.filter((s) => s.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(s) => String(s.id)}
      ListHeaderComponent={error ? <Muted style={{ color: c.danger }}>{error}</Muted> : undefined}
      ListEmptyComponent={<Muted>No reports waiting for review.</Muted>}
      renderItem={({ item }) => (
        <Card>
          <Text style={{ fontWeight: '600' }}>
            {[item.brand, item.product_name].filter(Boolean).join(' ')} {formatVolume(item.volume_ml ?? null)}
          </Text>
          <Text>{item.airport_iata} · {formatMoney(Number(item.price), item.currency)}</Text>
          <Muted>Seen {item.observed_on}{item.note ? ` · ${item.note}` : ''}</Muted>
          {item.photo_path ? <SubmissionPhoto path={item.photo_path} /> : null}
          <View style={styles.actions}>
            <View style={{ flex: 1, backgroundColor: 'transparent' }}><Button title="Approve" onPress={() => decide(item.id, true)} /></View>
            <View style={{ flex: 1, backgroundColor: 'transparent' }}><Button title="Reject" variant="danger" onPress={() => decide(item.id, false)} /></View>
          </View>
        </Card>
      )}
    />
  );
}

function SubmissionPhoto({ path }: { path: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    photoUrl(path).then(setUri).catch(() => {});
  }, [path]);
  return uri ? <Image source={{ uri }} style={styles.photo} /> : null;
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6, backgroundColor: 'transparent' },
  photo: { width: '100%', height: 220, borderRadius: 8 },
});
