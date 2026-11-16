"""Parsing and matching helpers shared by every adapter.

Products are matched across airports with a key built from brand, name and
volume, so "Johnnie Walker Black Label 1L" at BLR and "JOHNNIE WALKER Black
Label Blended Scotch Whisky 100cl" at AMS end up as the same product.
"""

from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation

_VOLUME_RE = re.compile(
    r"(?P<num>\d+(?:[.,]\d+)?)\s*(?P<unit>ml|cl|ltrs?|litres?|liters?|lt|l)\b",
    re.IGNORECASE,
)
_UNIT_TO_ML = {"ml": 1, "cl": 10, "l": 1000, "lt": 1000, "ltr": 1000, "ltrs": 1000,
               "litre": 1000, "litres": 1000, "liter": 1000, "liters": 1000}

# Words that describe the category rather than the product; dropping them
# lets differently worded listings of the same bottle match.
_NOISE_WORDS = {
    "blended", "scotch", "whisky", "whiskey", "single", "malt", "bourbon", "vodka",
    "gin", "rum", "tequila", "cognac", "liqueur", "the", "bottle", "edition",
    "gift", "box", "pack", "with", "and", "of",
}

_CURRENCY_SYMBOLS = {"₹": "INR", "€": "EUR", "£": "GBP", "$": "USD", "AED": "AED", "Dhs": "AED", "د.إ": "AED", "QAR": "QAR",
                     "Rs": "INR", "Rs.": "INR", "INR": "INR", "EUR": "EUR", "USD": "USD", "GBP": "GBP"}


def parse_volume_ml(text: str | None) -> int | None:
    """Return the bottle volume in millilitres, e.g. "70cl" -> 700, "1 Ltr" -> 1000."""
    if not text:
        return None
    match = None
    for match in _VOLUME_RE.finditer(text):
        pass  # keep the last match: names like "Glenfiddich 12 Year Old 1L"
    if not match:
        return None
    num = Decimal(match.group("num").replace(",", "."))
    unit = match.group("unit").lower()
    ml = int(num * _UNIT_TO_ML[unit])
    return ml if 20 <= ml <= 6000 else None


def parse_price(text: str | int | float | None) -> Decimal | None:
    """Parse "₹ 3,450.00", "€ 32,99", "1.234,50" or 3450 into a Decimal."""
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return Decimal(str(text))
    cleaned = re.sub(r"[^\d.,]", "", text)
    if not cleaned:
        return None
    if "," in cleaned and "." in cleaned:
        # Whichever separator comes last is the decimal separator.
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        head, _, tail = cleaned.rpartition(",")
        # "32,99" is a decimal comma; "3,450" is a thousands separator.
        cleaned = f"{head.replace(',', '')}.{tail}" if len(tail) == 2 else cleaned.replace(",", "")
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None
    return value if value > 0 else None


def detect_currency(text: str | None, default: str) -> str:
    if text:
        for symbol, code in _CURRENCY_SYMBOLS.items():
            if symbol in text:
                return code
    return default


def _ascii_words(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.findall(r"[a-z0-9]+", text.lower())


def match_key(name: str, brand: str | None = None, volume_ml: int | None = None) -> str:
    """Stable key for matching the same bottle across retailers."""
    without_volume = _VOLUME_RE.sub(" ", name)
    words = _ascii_words(f"{brand or ''} {without_volume}")
    seen: list[str] = []
    for word in words:
        if word in _NOISE_WORDS or word in seen:
            continue
        seen.append(word)
    # "12 year old" / "12yo" / "12 years" all become "12yo".
    key = " ".join(seen)
    key = re.sub(r"\b(\d+)\s*(?:yo|years?\s*old|years?|yrs?)\b", r"\1yo", key)
    key = re.sub(r"\bold\b", "", key)
    key = re.sub(r"\s+", " ", key).strip()
    return f"{key}|{volume_ml if volume_ml else '?'}"


_MULTIPACK_RE = re.compile(
    r"\b\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:ml|cl|l|ltr)\b|\b(?:twin|multi|gift)[\s-]*pack\b|\bpack[\s-]+(?:of[\s-]+)?\d+\b",
    re.IGNORECASE,
)


def is_multipack(*texts: str | None) -> bool:
    """True for "Double Black Pack 2x1L" and similar: the price covers several bottles,
    so comparing it with a single bottle elsewhere would be wrong."""
    return any(t and _MULTIPACK_RE.search(t.replace("-", " ")) for t in texts)
