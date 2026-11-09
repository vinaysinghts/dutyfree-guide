const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const formatInr = (amount: number) => inr.format(amount);

export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatVolume(ml: number | null) {
  if (!ml) return '';
  return ml >= 1000 ? `${ml / 1000}L` : `${ml / 10}cl`;
}

export const CURRENCIES = ['INR', 'EUR', 'USD', 'GBP', 'AED', 'QAR', 'SGD', 'TRY'] as const;
