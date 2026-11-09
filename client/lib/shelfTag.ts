/**
 * Turns raw OCR text from a shelf-tag photo into a price report draft.
 *
 * OCR gives us lines of text with no structure, and a duty-free tag usually
 * holds several numbers: the price, a "was"/high-street price, a per-litre
 * price, multi-buy offers, the ABV and the bottle size. This module decides
 * which number is the price we want. Pure functions, unit tested.
 */

export type ShelfTagDraft = {
  price: number | null;
  currency: string | null;
  volumeMl: number | null;
  brand: string | null;
  productName: string | null;
  /** Every price-looking amount we saw, for the reviewer. */
  candidates: PriceCandidate[];
  /** 0..1: how much of the tag we could read with certainty. */
  confidence: number;
};

export type PriceCandidate = {
  amount: number;
  currency: string | null;
  line: string;
  kind: 'price' | 'was' | 'per_unit' | 'multibuy' | 'now';
};

const CURRENCY_TOKENS: [RegExp, string][] = [
  [/€|\beur\b|\beuro?s?\b/i, 'EUR'],
  [/₹|\binr\b|\brs\.?(?=\s|\d|$)/i, 'INR'],
  [/£|\bgbp\b/i, 'GBP'],
  [/\baed\b|\bdhs?\b/i, 'AED'],
  [/\bqar\b|\bqr\b/i, 'QAR'],
  [/\bsgd\b|\bs\$/i, 'SGD'],
  [/\btry\b|₺|\btl\b/i, 'TRY'],
  [/\busd\b|\bus\$|\$/i, 'USD'],
];

// A number like 32,99 / 32.99 / 3,450 / 3.450,00 / 1 650 optionally glued to a currency.
const AMOUNT = String.raw`\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const MONEY_RE = new RegExp(
  String.raw`(€|₹|£|\$|₺|¥|\b(?:EUR|INR|GBP|USD|AED|QAR|SGD|TRY|Rs\.?|Dhs?|QR|US\$|S\$)\b)?\s*(${AMOUNT})\s*(€|₹|£|\$|₺|¥|\b(?:EUR|INR|GBP|USD|AED|QAR|SGD|TRY|Rs|euros?)\b)?`,
  'gi',
);

const VOLUME_RE = /(\d+(?:[.,]\d+)?)\s*(ml|cl|ltrs?|litres?|liters?|lt|l)\b/gi;
const UNIT_TO_ML: Record<string, number> = { ml: 1, cl: 10, l: 1000, lt: 1000, ltr: 1000, ltrs: 1000, litre: 1000, litres: 1000, liter: 1000, liters: 1000 };

const PER_UNIT_RE = /(\/\s*(l|lt|ltr|litre|liter|100\s*ml|cl)\b|\bper\s+(l|lt|ltr|litre|liter|100\s*ml)\b|\bprice\s+per\b)/i;
const WAS_RE = /\b(was|rrp|mrp|high\s*street|regular|retail|instead\s+of|normal(ly)?|downtown|city\s+price|old\s+price|vorher|statt)\b/i;
const NOW_RE = /\b(now|only|our\s+price|duty\s*free\s+price|offer\s+price|special|sale|today)\b/i;
const MULTIBUY_RE = /\b(\d\s*(for|x)\s*|buy\s+\d|any\s+\d)\b/i;
const PRICEISH_RE = /(€|₹|£|\$|₺|\b(EUR|INR|GBP|USD|AED|QAR|SGD|Rs)\b)|\d+[.,]\d{2}\b/i;
const NOISE_LINE_RE = /\b(vol|abv|alc|%|barcode|ean|sku|item\s*no|art\.?\s*nr|tax|duty|price|save|saving|offer|promotion|per|litre|liter)\b/i;

/** Common spirit brands, used to spot the brand line on a noisy tag. Extend freely. */
export const KNOWN_BRANDS = [
  'Johnnie Walker', 'Chivas Regal', 'Glenfiddich', 'Glenlivet', 'Macallan', 'Jameson', "Jack Daniel's",
  'Jim Beam', 'Maker\'s Mark', 'Woodford Reserve', 'Ballantine\'s', 'Dewar\'s', 'Monkey Shoulder', 'Talisker',
  'Lagavulin', 'Laphroaig', 'Ardbeg', 'Glenmorangie', 'Dalmore', 'Highland Park', 'Balvenie', 'Singleton',
  'Amrut', 'Paul John', 'Indri', 'Rampur', 'Yamazaki', 'Hibiki', 'Nikka', 'Absolut', 'Grey Goose',
  'Belvedere', 'Smirnoff', 'Ketel One', 'Ciroc', "Tito's", 'Bombay Sapphire', "Hendrick's", 'Tanqueray',
  'Beefeater', 'Monkey 47', 'Gordon\'s', 'Roku', 'Bacardi', 'Captain Morgan', 'Havana Club', 'Old Monk',
  'Diplomatico', 'Ron Zacapa', 'Hennessy', 'Rémy Martin', 'Martell', 'Courvoisier', 'Patrón', 'Don Julio',
  'Jose Cuervo', 'Baileys', 'Kahlúa', 'Cointreau', 'Jägermeister', 'Aperol', 'Campari', 'Moët & Chandon',
  'Veuve Clicquot', 'Dom Pérignon',
];

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator comes last is the decimal one.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const tail = s.length - lastComma - 1;
    s = tail === 2 || tail === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const tail = s.length - lastDot - 1;
    if (tail === 3) s = s.replace(/\./g, ''); // 3.450 = three thousand four hundred fifty
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function detectCurrency(text: string): string | null {
  for (const [re, code] of CURRENCY_TOKENS) if (re.test(text)) return code;
  return null;
}

export function parseVolumeMl(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(VOLUME_RE)) {
    const ml = Math.round(Number(m[1].replace(',', '.')) * UNIT_TO_ML[m[2].toLowerCase()]);
    if (ml >= 20 && ml <= 6000) best = ml;
  }
  return best;
}

function classify(line: string, matchStart: number, matchEnd: number): PriceCandidate['kind'] {
  const after = line.slice(matchEnd, matchEnd + 14);
  const before = line.slice(Math.max(0, matchStart - 24), matchStart);
  if (PER_UNIT_RE.test(after) || PER_UNIT_RE.test(before)) return 'per_unit';
  if (MULTIBUY_RE.test(before)) return 'multibuy';
  if (WAS_RE.test(before) || WAS_RE.test(line) && !NOW_RE.test(before)) return 'was';
  if (NOW_RE.test(before) || NOW_RE.test(line)) return 'now';
  return 'price';
}

export function findPriceCandidates(lines: string[]): PriceCandidate[] {
  const out: PriceCandidate[] = [];
  for (const line of lines) {
    for (const m of line.matchAll(MONEY_RE)) {
      const [whole, pre, amountText, post] = m;
      const amount = parseAmount(amountText);
      if (amount == null) continue;
      const currencyText = pre || post || '';
      const hasDecimals = /[.,]\d{2}$/.test(amountText.trim());
      // Skip bare integers with no currency (years, ABV, sizes, article numbers),
      // unless the line says it's a price ("Now 4,300").
      if (!currencyText && !hasDecimals && !NOW_RE.test(line) && !WAS_RE.test(line)) continue;
      const start = m.index ?? 0;
      const end = start + whole.length;
      const tail = line.slice(end, end + 4);
      if (/^\s*(%|ml|cl|l\b|lt|yo|y\.o|years?)/i.test(tail)) continue;
      out.push({
        amount,
        // A symbol we can't map (OCR often reads ₹ as ¥) leaves the currency to the airport default.
        currency: currencyText ? detectCurrency(currencyText) : null,
        line: line.trim(),
        kind: classify(line, start, end),
      });
    }
  }
  return out;
}

/** Pick the price a traveller would actually pay. */
export function choosePrice(candidates: PriceCandidate[]): PriceCandidate | null {
  const now = candidates.filter((c) => c.kind === 'now');
  if (now.length) return now.reduce((a, b) => (b.amount < a.amount ? b : a));
  const plain = candidates.filter((c) => c.kind === 'price');
  if (!plain.length) return null;
  // Tags that show two plain prices are usually "high street vs duty free":
  // the lower one is ours. Prefer amounts that carry a currency.
  const withCurrency = plain.filter((c) => c.currency);
  const pool = withCurrency.length ? withCurrency : plain;
  return pool.reduce((a, b) => (b.amount < a.amount ? b : a));
}

export function findBrand(text: string): string | null {
  const folded = fold(text).replace(/[’']/g, "'");
  let best: string | null = null;
  for (const brand of KNOWN_BRANDS) {
    const b = fold(brand).replace(/[’']/g, "'");
    // OCR often drops apostrophes: match "jack daniels" too.
    if (folded.includes(b) || folded.includes(b.replace(/'/g, ''))) {
      if (!best || brand.length > best.length) best = brand;
    }
  }
  return best;
}

function productLine(lines: string[], brand: string | null): string | null {
  const usable = lines
    .map((l) => l.trim())
    .filter((l) => /[a-z]{3,}/i.test(l) && !PRICEISH_RE.test(l) && !NOISE_LINE_RE.test(l));
  if (brand) {
    const withBrand = usable.find((l) => fold(l).includes(fold(brand).replace(/'/g, '')) || fold(l).includes(fold(brand)));
    if (withBrand) {
      const rest = withBrand.replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\']/g, '.?'), 'i'), '').trim();
      if (rest.length >= 3) return cleanName(rest);
      // Brand alone on its line: the next usable line is usually the expression ("Black Label").
      const next = usable[usable.indexOf(withBrand) + 1];
      return next ? cleanName(next) : null;
    }
  }
  return usable.length ? cleanName(usable.reduce((a, b) => (b.length > a.length ? b : a))) : null;
}

const cleanName = (s: string) =>
  s.replace(VOLUME_RE, '').replace(/\s{2,}/g, ' ').replace(/^[\W_]+|[\W_]+$/g, '').trim() || s.trim();

export function parseShelfTag(ocrText: string, opts: { defaultCurrency?: string } = {}): ShelfTagDraft {
  const lines = ocrText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const candidates = findPriceCandidates(lines);
  const chosen = choosePrice(candidates);
  const brand = findBrand(ocrText);
  const volumeMl = parseVolumeMl(ocrText);
  const productName = productLine(lines, brand);
  const currency = chosen?.currency ?? detectCurrency(ocrText) ?? opts.defaultCurrency ?? null;

  let confidence = 0;
  if (chosen) confidence += 0.45;
  if (chosen?.currency) confidence += 0.15;
  if (volumeMl) confidence += 0.15;
  if (brand) confidence += 0.15;
  if (productName) confidence += 0.1;

  return {
    price: chosen?.amount ?? null,
    currency,
    volumeMl,
    brand,
    productName,
    candidates,
    confidence: Math.round(confidence * 100) / 100,
  };
}
