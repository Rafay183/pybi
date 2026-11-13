"""Version parsing and comparison for release tags.

Accepts the forms people actually tag with: ``v1.2.3``, ``1.2``, ``1.2.3rc1``,
``1.2.3-beta.2``, ``1.2.3.dev4``, ``v2.0.0-alpha``. Ordering follows PEP 440 for
these cases: dev < alpha < beta < rc < final < post.
"""
from __future__ import annotations

import re
from functools import total_ordering

_PRE = {"dev": 0, "a": 1, "alpha": 1, "b": 2, "beta": 2, "c": 3, "rc": 3, "pre": 3, "preview": 3}
_FINAL = 4
_POST = 5

_RE = re.compile(
    r"""^\s*v?
        (?P<nums>\d+(?:\.\d+)*)
        (?:[-_.]?(?P<label>dev|alpha|a|beta|b|preview|pre|rc|c|post)[-_.]?(?P<n>\d+)?)?
        (?:\+.*)?\s*$""",
    re.IGNORECASE | re.VERBOSE,
)


@total_ordering
class Version:
    __slots__ = ("raw", "nums", "rank", "n")

    def __init__(self, raw: str):
        m = _RE.match(raw or "")
        if not m:
            raise ValueError(f"Not a version: {raw!r}")
        nums = [int(x) for x in m.group("nums").split(".")]
        while len(nums) < 3:
            nums.append(0)
        while len(nums) > 3 and nums[-1] == 0:
            nums.pop()
        label = (m.group("label") or "").lower()
        if not label:
            rank = _FINAL
        elif label == "post":
            rank = _POST
        else:
            rank = _PRE[label]
        self.raw = raw.strip()
        self.nums = tuple(nums)
        self.rank = rank
        self.n = int(m.group("n") or 0)

    @property
    def is_prerelease(self) -> bool:
        return self.rank < _FINAL

    def _key(self):
        return (self.nums, self.rank, self.n)

    def __eq__(self, other):
        return isinstance(other, Version) and self._key() == other._key()

    def __lt__(self, other):
        return self._key() < other._key()

    def __hash__(self):
        return hash(self._key())

    def __str__(self):
        return self.raw.lstrip("vV")

    def __repr__(self):
        return f"Version({self.raw!r})"


def parse(raw: str) -> Version | None:
    try:
        return Version(raw)
    except ValueError:
        return None


def is_newer(candidate: str, current: str) -> bool:
    """True when ``candidate`` is a strictly newer version than ``current``."""
    a, b = parse(candidate), parse(current)
    if a is None:
        return False
    if b is None:  # unknown/dev build: any real release counts as newer
        return True
    return a > b
