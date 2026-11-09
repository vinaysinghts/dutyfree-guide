import * as ImagePicker from 'expo-image-picker';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet } from 'react-native';

import { AirportSearch } from '@/components/AirportSearch';
import { Text, View } from '@/components/Themed';
import { Button, Chip, Input, Muted, useColors } from '@/components/ui';
import { isAdmin, submitPrice } from '@/lib/api';
import { CURRENCIES } from '@/lib/format';
import { isDemoMode } from '@/lib/supabase';
import { useTrip } from '@/lib/trip';
import type { Airport } from '@/lib/types';

const DEFAULT_CURRENCY: Record<string, string> = { IN: 'INR', AE: 'AED', QA: 'QAR', SG: 'SGD', GB: 'GBP', TR: 'TRY', US: 'USD' };
const currencyFor = (a: Airport | null) => (a ? DEFAULT_CURRENCY[a.country_code] ?? 'EUR' : 'INR');

export default function ReportScreen() {
  const c = useColors();
  const trip = useTrip();
  const [airport, setAirport] = useState<Airport | null>(trip.airports[0] ?? null);
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [volume, setVolume] = useState('1000');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(() => currencyFor(trip.airports[0] ?? null));
  const [note, setNote] = useState('');
  const [photoUri, setPhotoUri] = useState<string | undefined>();
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

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  const priceValue = Number(price.replace(',', '.'));
  const volumeValue = volume ? Number(volume) : undefined;
  const valid = airport && productName.trim().length >= 2 && priceValue > 0 &&
    (volumeValue === undefined || (volumeValue >= 50 && volumeValue <= 5000));

  const submit = async () => {
    if (!airport || !valid) return;
    setBusy(true);
    setMessage(null);
    try {
      await submitPrice({
        airport_iata: airport.iata,
        product_name: productName.trim(),
        brand: brand.trim() || undefined,
        volume_ml: volumeValue,
        price: priceValue,
        currency,
        note: note.trim() || undefined,
        photoUri,
      });
      setMessage({ ok: true, text: 'Thanks! Your price will appear once it has been reviewed.' });
      setProductName('');
      setBrand('');
      setPrice('');
      setNote('');
      setPhotoUri(undefined);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Saw a price on the shelf?</Text>
      <Muted>Reports are checked before they show up for other travellers.</Muted>
      {isDemoMode ? <Muted style={{ color: c.warn }}>Demo mode: reports can't be sent without the backend.</Muted> : null}

      <Text style={styles.label}>Airport</Text>
      <View style={styles.chips}>
        {trip.airports.map((a) => (
          <Chip key={a.iata} label={a.iata} selected={airport?.iata === a.iata} onPress={() => pickAirport(a)} />
        ))}
        {airport && !trip.airports.some((a) => a.iata === airport.iata) ? <Chip label={airport.iata} selected /> : null}
      </View>
      <AirportSearch onPick={pickAirport} placeholder="Or search another airport" />

      <Input label="Product" value={productName} onChangeText={setProductName} placeholder="e.g. Black Label" />
      <Input label="Brand (optional)" value={brand} onChangeText={setBrand} placeholder="e.g. Johnnie Walker" />
      <Input label="Bottle size in ml" value={volume} onChangeText={setVolume} keyboardType="number-pad" />
      <Input label="Price on the tag" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="e.g. 32.99" />

      <Text style={styles.label}>Currency</Text>
      <View style={styles.chips}>
        {CURRENCIES.map((cur) => <Chip key={cur} label={cur} selected={currency === cur} onPress={() => setCurrency(cur)} />)}
      </View>

      <Input label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. 2-for-1 offer, Terminal 2" />
      <Button title={photoUri ? 'Change shelf-tag photo' : 'Add a shelf-tag photo (optional)'} variant="ghost" onPress={pickPhoto} />
      {photoUri ? <Image source={{ uri: photoUri }} style={styles.photo} /> : null}

      <Button title="Send for review" onPress={submit} disabled={!valid || isDemoMode} busy={busy} />
      {message ? <Text style={{ color: message.ok ? c.tint : c.danger }}>{message.text}</Text> : null}

      {admin ? <Link href="/review" style={{ color: c.tint, fontWeight: '600' }}>Review pending reports</Link> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, maxWidth: 720, width: '100%', alignSelf: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  label: { fontWeight: '600', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: 'transparent' },
  photo: { width: '100%', height: 200, borderRadius: 10 },
});
