import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Switch } from 'react-native';

import { Text, View } from '@/components/Themed';
import { Button, Card, Chip, Input, Muted, useColors } from '@/components/ui';
import { submitIssueReport } from '@/lib/api';
import { collectContext } from '@/lib/deviceContext';
import {
  ISSUE_CATEGORIES,
  MAX_SCREENSHOTS,
  newIssueUrl,
  recentCapture,
  shareableContext,
  validateReport,
  type IssueCategory,
  type IssueReportResult,
} from '@/lib/issueReport';
import { isDemoMode } from '@/lib/supabase';
import { useTrip } from '@/lib/trip';

export default function ReportIssueScreen() {
  const c = useColors();
  const router = useRouter();
  const trip = useTrip();

  // Taken by the header button just before this screen opened.
  const [capture] = useState(() => recentCapture());
  const [screenshots, setScreenshots] = useState<string[]>(capture?.uri ? [capture.uri] : []);
  const [category, setCategory] = useState<IssueCategory>('bug');
  const [description, setDescription] = useState('');
  const [includeTrip, setIncludeTrip] = useState(true);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IssueReportResult | null>(null);

  const context = useMemo(
    () =>
      shareableContext(collectContext(capture?.screen, trip.airports.map((a) => a.iata)), { includeTrip, includeLogs }),
    [capture?.screen, trip.airports, includeTrip, includeLogs],
  );

  const addScreenshots = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: MAX_SCREENSHOTS - screenshots.length,
    });
    if (!res.canceled) setScreenshots((s) => [...s, ...res.assets.map((a) => a.uri)].slice(0, MAX_SCREENSHOTS));
  };

  const submit = async () => {
    const invalid = validateReport({ description, screenshotUris: screenshots });
    if (invalid) return setError(invalid);
    setError(null);

    if (isDemoMode) {
      // No backend in demo builds: hand over to GitHub's own form instead.
      Linking.openURL(newIssueUrl({ category, description, context }));
      return;
    }

    setBusy(true);
    try {
      setResult(await submitIssueReport({ category, description, screenshotUris: screenshots, context }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the report.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <View style={styles.done}>
        <Text style={styles.title}>Thanks, got it.</Text>
        {result.status === 'filed' ? (
          <>
            <Muted style={styles.center}>It's now issue #{result.issueNumber}. You can follow it there.</Muted>
            <Button title={`Open issue #${result.issueNumber}`} variant="ghost" onPress={() => Linking.openURL(result.issueUrl)} />
          </>
        ) : (
          <Muted style={styles.center}>
            Your report is saved (#{result.reportId}) and will be posted to our issue tracker shortly.
          </Muted>
        )}
        <Button title="Done" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>What kind of problem?</Text>
      <View style={styles.chips}>
        {ISSUE_CATEGORIES.map((cat) => (
          <Chip key={cat.value} label={cat.label} selected={category === cat.value} onPress={() => setCategory(cat.value)} />
        ))}
      </View>

      <Input
        label="What happened? What did you expect?"
        placeholder="e.g. Prices tab is empty for BLR, it showed 40 bottles yesterday"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={4000}
        style={styles.description}
        autoFocus={!capture?.uri}
      />

      <Text style={styles.label}>Screenshots</Text>
      <View style={styles.shots}>
        {screenshots.map((uri, i) => (
          <View key={uri} style={styles.shotWrap}>
            <Image source={{ uri }} style={[styles.shot, { borderColor: c.border }]} accessibilityLabel={`Screenshot ${i + 1}`} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove screenshot ${i + 1}`}
              onPress={() => setScreenshots((s) => s.filter((x) => x !== uri))}
              style={[styles.remove, { backgroundColor: c.danger }]}>
              <Text style={{ color: c.onTint, fontWeight: '700' }}>×</Text>
            </Pressable>
          </View>
        ))}
        {screenshots.length < MAX_SCREENSHOTS ? (
          <Pressable
            accessibilityRole="button"
            onPress={addScreenshots}
            style={[styles.shot, styles.add, { borderColor: c.border }]}>
            <Text style={{ color: c.tint, fontSize: 28 }}>+</Text>
            <Muted>Add</Muted>
          </Pressable>
        ) : null}
      </View>
      {capture?.uri ? <Muted>We took a screenshot of the screen you were on. Remove it if it shows anything private.</Muted> : null}

      <Card>
        <View style={styles.toggle}>
          <Text style={styles.flex}>Include my trip airports</Text>
          <Switch value={includeTrip} onValueChange={setIncludeTrip} />
        </View>
        <View style={styles.toggle}>
          <Text style={styles.flex}>Include recent app errors</Text>
          <Switch value={includeLogs} onValueChange={setIncludeLogs} />
        </View>
        <Pressable onPress={() => setShowDetails((v) => !v)} accessibilityRole="button">
          <Muted style={{ color: c.tint }}>{showDetails ? 'Hide' : 'Show'} everything that will be sent</Muted>
        </Pressable>
        {showDetails ? (
          <Text selectable style={styles.mono}>
            {JSON.stringify(context, null, 2)}
          </Text>
        ) : null}
      </Card>

      <Muted>
        {isDemoMode
          ? 'This build has no backend, so this opens GitHub with the report filled in. Attach the screenshots there.'
          : 'Your note, screenshots and the details above are posted as a public issue on our GitHub so we can fix it. No name, email or location is included.'}
      </Muted>

      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      <Button title={isDemoMode ? 'Continue on GitHub' : 'Send report'} onPress={submit} busy={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  done: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  center: { textAlign: 'center' },
  label: { fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: 'transparent' },
  description: { minHeight: 110, textAlignVertical: 'top' },
  shots: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, backgroundColor: 'transparent' },
  shotWrap: { backgroundColor: 'transparent' },
  shot: { width: 84, height: 150, borderRadius: 8, borderWidth: 1 },
  add: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
  remove: { position: 'absolute', top: -8, right: -8, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  mono: { fontFamily: 'SpaceMono', fontSize: 11 },
});
