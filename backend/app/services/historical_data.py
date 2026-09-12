import asyncio
import csv
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from google import genai
from google.cloud import aiplatform

from app.config import settings

logger = logging.getLogger("historical_data")

_STOPWORDS = {"the", "a", "an", "and", "or", "of", "to", "in", "on", "into", "all", "for", "is", "are"}


def _keywords(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", text.lower()) if w not in _STOPWORDS and len(w) > 2}


@dataclass
class HistoricalRule:
    id: str
    type: str
    description: str


_rules: list[HistoricalRule] = []
_rules_by_id: dict[str, HistoricalRule] = {}


def load(csv_path: Path) -> dict:
    """CSV -> validated rows. Malformed rows are skipped, not fatal.

    In real mode these rows aren't queried directly -- they're the same rows
    embedded and upserted into the Vector Search index out of band (Phase 3).
    This load only needs to happen here so `id` -> HistoricalRule lookups can
    resolve the neighbor IDs Vector Search returns.
    """
    global _rules, _rules_by_id
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
    _rules_by_id = {r.id: r for r in rules}
    return {"indexed": len(rules), "skipped": skipped}


def all_rules() -> list[HistoricalRule]:
    return list(_rules)


# ponytail: _find_matches_mock is a lexical stand-in for real retrieval, used
# while LOCAL_MODE=true, since it has no embedding API available. It filters
# to the issue categories the analyzer already found, then ranks within that
# category by keyword overlap against the issue text -- an honest lexical
# proxy rather than fabricated cosine-similarity scores with no real vectors
# behind them. find_matches() below picks between it and _find_matches_vertex
# based on settings.local_mode.
def _find_matches_mock(categories: set[str], hint_text: str, limit: int) -> list[HistoricalRule]:
    candidates = [r for r in _rules if r.type in categories]
    hint_words = _keywords(hint_text)
    if not hint_words:
        return candidates[:limit]

    scored = [(len(_keywords(r.description) & hint_words), r) for r in candidates]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    ranked = [r for score, r in scored if score > 0] or candidates
    return ranked[:limit]


_genai_client: genai.Client | None = None
_index_endpoint: aiplatform.MatchingEngineIndexEndpoint | None = None


def _get_genai_client() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        _genai_client = genai.Client(vertexai=True, project=settings.google_cloud_project, location=settings.google_cloud_location)
    return _genai_client


def _get_index_endpoint() -> aiplatform.MatchingEngineIndexEndpoint:
    global _index_endpoint
    if _index_endpoint is None:
        aiplatform.init(project=settings.google_cloud_project, location=settings.google_cloud_location)
        _index_endpoint = aiplatform.MatchingEngineIndexEndpoint(settings.vector_search_endpoint)
    return _index_endpoint


async def _find_matches_vertex(code: str, language: str, limit: int) -> list[HistoricalRule]:
    """Real retrieval: embed the submitted code, then query the Vector Search
    index (built out of band from historical-review-rules.csv, Phase 3) for
    the nearest historical rules. Run BEFORE the Gemini call so matches become
    prompt context, unlike the mock which filters by categories Gemini already
    found."""
    client = _get_genai_client()
    embed_response = await client.aio.models.embed_content(
        model=settings.embedding_model,
        contents=f"{language} code review:\n{code[:2000]}",
    )
    query_vector = embed_response.embeddings[0].values

    endpoint = _get_index_endpoint()
    results = await asyncio.to_thread(
        endpoint.find_neighbors,
        deployed_index_id=settings.vector_search_index,
        queries=[query_vector],
        num_neighbors=limit,
    )

    matches = []
    for neighbor in results[0]:
        rule = _rules_by_id.get(neighbor.id)
        if rule:
            matches.append(rule)
        else:
            logger.warning("vector search returned unknown rule id=%s", neighbor.id)
    return matches


async def find_matches(
    code: str, language: str, limit: int = 3, categories: set[str] | None = None, hint_text: str = ""
) -> list[HistoricalRule]:
    if settings.local_mode:
        return _find_matches_mock(categories or set(), hint_text, limit)
    return await _find_matches_vertex(code, language, limit)
