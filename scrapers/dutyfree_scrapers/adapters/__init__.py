from .base import Adapter
from .dubaidutyfree import DubaiDutyFreeAdapter
from .schiphol import SchipholAdapter
from .shopdutyfree import ShopDutyFreeAdapter

ADAPTERS: dict[str, type[Adapter]] = {
    ShopDutyFreeAdapter.slug: ShopDutyFreeAdapter,
    SchipholAdapter.slug: SchipholAdapter,
    DubaiDutyFreeAdapter.slug: DubaiDutyFreeAdapter,
}

__all__ = ["ADAPTERS", "Adapter"]
