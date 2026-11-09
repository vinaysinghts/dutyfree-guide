from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from .normalize import match_key


@dataclass(frozen=True)
class ScrapedProduct:
    name: str
    price: Decimal
    currency: str
    url: str | None = None
    brand: str | None = None
    volume_ml: int | None = None
    image_url: str | None = None
    category: str = "spirits"
    key: str = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "key", match_key(self.name, self.brand, self.volume_ml))

    def as_json(self) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "brand": self.brand,
            "volume_ml": self.volume_ml,
            "price": str(self.price),
            "currency": self.currency,
            "url": self.url,
            "image_url": self.image_url,
            "category": self.category,
        }
