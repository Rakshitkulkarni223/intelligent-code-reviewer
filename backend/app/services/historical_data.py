import csv
import re
from dataclasses import dataclass
from pathlib import Path

_STOPWORDS = {"the", "a", "an", "and", "or", "of", "to", "in", "on", "into", "all", "for", "is", "are"}


def _keywords(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", text.lower()) if w not in _STOPWORDS and len(w) > 2}


@dataclass
class HistoricalRule:
    id: str
    type: str
    description: str


_rules: list[HistoricalRule] = []


def load(csv_path: Path) -> dict:
    """CSV -> validated rows. Malformed rows are skipped, not fatal."""
    global _rules
    rules: list[HistoricalRule] = []
    skipped = 0
    with csv_path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rid = (row.get("id") or "").strip()
            rtype = (row.get("type") or "").strip()
            desc = (row.get("description") or "").strip()
            if not rid or not rtype or not desc:
                skipped += 1
                continue
            rules.append(HistoricalRule(rid, rtype, desc))
    _rules = rules
    return {"indexed": len(rules), "skipped": skipped}


def all_rules() -> list[HistoricalRule]:
    return list(_rules)


# ponytail: real retrieval is Vertex AI Embeddings + Vector Search over rule
# descriptions (Phase 6/10), run BEFORE the Gemini call so matched rules become
# prompt context. Locally, with no embedding API available, we retrieve by
# filtering to the issue categories the analyzer already found, then ranking
# within that category by keyword overlap against the issue text -- an honest
# lexical stand-in rather than fabricated cosine-similarity scores with no
# real vectors behind them.
def find_matches(categories: set[str], hint_text: str = "", limit: int = 3) -> list[HistoricalRule]:
    candidates = [r for r in _rules if r.type in categories]
    hint_words = _keywords(hint_text)
    if not hint_words:
        return candidates[:limit]

    scored = [(len(_keywords(r.description) & hint_words), r) for r in candidates]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    ranked = [r for score, r in scored if score > 0] or candidates
    return ranked[:limit]
