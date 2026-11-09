from .base import Adapter
from .schiphol import SchipholAdapter
from .shopdutyfree import ShopDutyFreeAdapter

ADAPTERS: dict[str, type[Adapter]] = {
    ShopDutyFreeAdapter.slug: ShopDutyFreeAdapter,
    SchipholAdapter.slug: SchipholAdapter,
}

__all__ = ["ADAPTERS", "Adapter"]
