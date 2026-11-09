import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';

import { AirportSearch } from '@/components/AirportSearch';
import { Text, View } from '@/components/Themed';
import { Button, Card, Chip, Input, Muted, useColors } from '@/components/ui';
import { isAdmin, nearestAirports, submitPrice } from '@/lib/api';
import { CURRENCIES, formatMoney, formatVolume } from '@/lib/format';
import { AT_AIRPORT_KM, gpsFromExif, takenAtFromExif } from '@/lib/geo';
import { readText } from '@/lib/ocr';
import { parseShelfTag, type ShelfTagDraft } from '@/lib/shelfTag';
import { isDemoMode } from '@/lib/supabase';
import { useTrip } from '@/lib/trip';
import type { Airport, CaptureLocation } from '@/lib/types';

const DEFAULT_CURRENCY: Record<string, string> = { IN: 'INR', AE: 'AED', QA: 'QAR', SG: 'SGD', GB: 'GBP', TR: 'TRY', US: 'USD' };
const currencyFor = (a: Airport | null) => (a ? DEFAULT_CURRENCY[a.country_code] ?? 'EUR' : 'INR');

type Photo = { uri: string; takenAt?: string };
type Located = { location: CaptureLocation; airport: Airport | null; km: number | null };

export default function ReportScreen() {
  const c = useColors();
  const trip = useTrip();

  const [photo, setPhoto] = useState<Photo | null>(null);
  const [reading, setReading] = useState(false);
  const [ocrText, setOcrText] = useState<string | undefined>();
  const [draft, setDraft] = useState<ShelfTagDraft | null>(null);
  const [located, setLocated] = useState<Located | null>(null);
  const [locating, setLocating] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const [airport, setAirport] = useState<Airport | null>(trip.airports[0] ?? null);
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [volume, setVolume] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(() => currencyFor(trip.airports[0] ?? null));
  const [note, setNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    isAdmin().then(setAdmin).catch(() => {});
  }, []);

  const pickAirport = (a: Airport) => {
    setAirport(a);
    setCurrency(currencyFor(a));
  };

  const reset = () => {
    setPhoto(null);
    setOcrText(undefined);
    setDraft(null);
    setLocated(null);
    setProductName('');
    setBrand('');
    setVolume('');
    setPrice('');
    setNote('');
    setShowDetails(false);
  };

  /** Where was the photo taken? Live GPS for a fresh camera shot, EXIF GPS for a gallery photo. */
  const locate = async (fromCamera: boolean, exif?: Record<string, unknown> | null): Promise<Located | null> => {
    let location: CaptureLocation | null = null;
    const exifGps = gpsFromExif(exif);
    if (exifGps) location = { ...exifGps, source: 'exif' };
    if (!location && fromCamera) {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        location = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? undefined,
          source: 'device',
        };
      }
    }
    if (!location) return null;
    const [nearest] = await nearestAirports(location, 1);
    return { location, airport: nearest ?? null, km: nearest?.distance_km ?? null };
  };

  const takePhoto = async (fromCamera: boolean) => {
    setMessage(null);
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, exif: true };
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted && Platform.OS !== 'web') {
        setMessage({ ok: false, text: 'Camera permission is needed to snap the tag. You can pick a photo instead.' });
        return;
      }
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    const asset = result.assets[0];
    const exif = (asset.exif ?? null) as Record<string, unknown> | null;
    const takenAt = takenAtFromExif(exif)?.toISOString() ?? (fromCamera ? new Date().toISOString() : undefined);
    reset();
    setPhoto({ uri: asset.uri, takenAt });

    // Location and OCR run in parallel; neither blocks sending the photo.
    setLocating(true);
    const locationJob = locate(fromCamera, exif)
      .then((l) => {
        setLocated(l);
        if (l?.airport && l.km != null && l.km <= 50) pickAirport(l.airport);
        return l;
      })
      .catch(() => null)
      .finally(() => setLocating(false));

    setReading(true);
    try {
      const text = await readText(asset.uri);
      const l = await locationJob;
      const parsed = parseShelfTag(text, { defaultCurrency: currencyFor(l?.airport ?? airport) });
      setOcrText(text);
      setDraft(parsed);
      if (parsed.productName) setProductName(parsed.productName);
      if (parsed.brand) setBrand(parsed.brand);
      if (parsed.volumeMl) setVolume(String(parsed.volumeMl));
      if (parsed.price != null) setPrice(String(parsed.price));
      if (parsed.currency) setCurrency(parsed.currency);
      if (parsed.confidence < 0.6) setShowDetails(true);
    } catch {
      // OCR is a convenience: the reviewer can still read the photo.
      setShowDetails(true);
    } finally {
      setReading(false);
    }
  };

  const priceValue = price ? Number(price.replace(',', '.')) : undefined;
  const volumeValue = volume ? Number(volume) : undefined;
  const typedComplete = productName.trim().length >= 2 && priceValue != null && priceValue > 0;
  const fieldsValid =
    (priceValue === undefined || priceValue > 0) &&
    (volumeValue === undefined || (volumeValue >= 50 && volumeValue <= 5000));
  const valid = !!airport && fieldsValid && (!!photo || typedComplete);

  const submit = async () => {
    if (!airport || !valid) return;
    setBusy(true);
    setMessage(null);
    try {
      await submitPrice({
        airport_iata: airport.iata,
        product_name: productName.trim() || undefined,
        brand: brand.trim() || undefined,
        volume_ml: volumeValue,
        price: priceValue,
        currency: priceValue != null ? currency : undefined,
        note: note.trim() || undefined,
        photoUri: photo?.uri,
        ocrText,
        ocrDraft: draft ?? undefined,
        location: located?.location,
        photoTakenAt: photo?.takenAt,
      });
      setMessage({ ok: true, text: 'Thanks! Your price will appear once it has been checked.' });
      reset();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const summary = draft && draft.price != null
    ? [[brand, productName].filter(Boolean).join(' '), formatVolume(volumeValue ?? null), formatMoney(draft.price, currency)]
        .filter(Boolean).join(' · ')
    : null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Saw a price on the shelf?</Text>
      <Muted>Snap the price tag. We'll read it and check it before other travellers see it.</Muted>
      {isDemoMode ? <Muted style={{ color: c.warn }}>Demo mode: reports can't be sent without the backend.</Muted> : null}

      {!photo ? (
        <View style={styles.row}>
          <View style={styles.flex}><Button title="Snap the tag" onPress={() => takePhoto(true)} /></View>
          <View style={styles.flex}><Button title="Pick a photo" variant="ghost" onPress={() => takePhoto(false)} /></View>
        </View>
      ) : (
        <Card>
          <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" accessibilityLabel="Shelf tag photo" />
          {reading ? (
            <View style={styles.row}><ActivityIndicator /><Muted>Reading the tag…</Muted></View>
          ) : summary ? (
            <Text style={{ fontWeight: '600' }}>We read: {summary}</Text>
          ) : (
            <Muted>We couldn't read the price. Add it below, or just send the photo.</Muted>
          )}
          <LocationBadge located={located} locating={locating} airport={airport} />
          <Pressable onPress={reset}><Text style={{ color: c.tint }}>Retake</Text></Pressable>
        </Card>
      )}

      <Text style={styles.label}>Airport</Text>
      <View style={styles.chips}>
        {trip.airports.map((a) => (
          <Chip key={a.iata} label={a.iata} selected={airport?.iata === a.iata} onPress={() => pickAirport(a)} />
        ))}
        {airport && !trip.airports.some((a) => a.iata === airport.iata) ? <Chip label={airport.iata} selected /> : null}
      </View>
      <AirportSearch onPick={pickAirport} placeholder="Or search another airport" />

      <Pressable onPress={() => setShowDetails((v) => !v)}>
        <Text style={{ color: c.tint, fontWeight: '600' }}>
          {showDetails ? 'Hide details' : photo ? 'Check or correct the details' : 'No photo? Type the details'}
        </Text>
      </Pressable>

      {showDetails ? (
        <>
          <Input label="Product" value={productName} onChangeText={setProductName} placeholder="e.g. Black Label" />
          <Input label="Brand" value={brand} onChangeText={setBrand} placeholder="e.g. Johnnie Walker" />
          <Input label="Bottle size in ml" value={volume} onChangeText={setVolume} keyboardType="number-pad" placeholder="e.g. 1000" />
          <Input label="Price on the tag" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="e.g. 32.99" />
          <Text style={styles.label}>Currency</Text>
          <View style={styles.chips}>
            {CURRENCIES.map((cur) => <Chip key={cur} label={cur} selected={currency === cur} onPress={() => setCurrency(cur)} />)}
          </View>
          <Input label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. 2-for-1 offer, Terminal 2" />
        </>
      ) : null}

      <Button title="Send for review" onPress={submit} disabled={!valid || isDemoMode || reading} busy={busy} />
      {message ? <Text style={{ color: message.ok ? c.tint : c.danger }}>{message.text}</Text> : null}

      {admin ? <Link href="/review" style={{ color: c.tint, fontWeight: '600' }}>Review pending reports</Link> : null}
    </ScrollView>
  );
}

function LocationBadge({ located, locating, airport }: { located: Located | null; locating: boolean; airport: Airport | null }) {
  const c = useColors();
  if (locating) return <Muted>Checking where the photo was taken…</Muted>;
  if (!located) return <Muted>Location not available. The reviewer will check the photo.</Muted>;
  const atChosen = located.airport && airport && located.airport.iata === airport.iata && located.km != null && located.km <= AT_AIRPORT_KM;
  if (atChosen) return <Text style={{ color: c.tint }}>📍 Taken at {airport!.iata}</Text>;
  if (located.airport && located.km != null) {
    return (
      <Text style={{ color: c.warn }}>
        📍 Taken {located.km < 1 ? 'at' : `${Math.round(located.km)} km from`} {located.airport.iata}
        {airport && located.airport.iata !== airport.iata ? `, not ${airport.iata}` : ''}
      </Text>
    );
  }
  return <Muted>Location found, but no airport nearby.</Muted>;
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, maxWidth: 720, width: '100%', alignSelf: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  label: { fontWeight: '600', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: 'transparent' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'transparent' },
  flex: { flex: 1, backgroundColor: 'transparent' },
  photo: { width: '100%', height: 220, borderRadius: 10 },
});
