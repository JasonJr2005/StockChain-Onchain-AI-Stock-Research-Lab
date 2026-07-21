"""Small shared utilities — currently a thread-safe, size-bounded TTL cache.

Used by the Yahoo data provider (history / info / search) and by the research
orchestrator (per-symbol analysis results) so repeated UI requests inside one
browser session never hammer the upstream data source twice for the same thing.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any


class TTLCache:
    """Thread-safe TTL cache with an LRU-style size bound.

    Entries expire after ``ttl_seconds``; when more than ``max_entries`` keys
    are stored the least-recently-used one is evicted. Both bounds keep a
    long-running API process from growing without limit.
    """

    def __init__(self, ttl_seconds: float, *, max_entries: int = 256) -> None:
        self._ttl = ttl_seconds
        self._max = max(1, max_entries)
        self._data: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            hit = self._data.get(key)
            if hit is None:
                return None
            ts, val = hit
            if time.time() - ts > self._ttl:
                self._data.pop(key, None)
                return None
            self._data.move_to_end(key)
            return val

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = (time.time(), value)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
