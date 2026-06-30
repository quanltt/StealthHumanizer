const OPENALEX_BASE_URL = "https://api.openalex.org/works";

function decodeInvertedIndex(indexObj) {
  if (!indexObj || typeof indexObj !== "object") return "";
  const wordPositions = [];
  for (const [token, positions] of Object.entries(indexObj)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      wordPositions.push([Number(pos), token]);
    }
  }
  wordPositions.sort((a, b) => a[0] - b[0]);
  return wordPositions.map(([, token]) => token).join(" ");
}

function mapOpenAlexWork(work) {
  const authors = Array.isArray(work.authorships)
    ? work.authorships
        .map((a) => a?.author?.display_name)
        .filter(Boolean)
        .slice(0, 10)
    : [];

  const source = work?.primary_location?.source;
  const license = work?.open_access?.oa_status || work?.open_access?.license || "";

  return {
    id: work.id || "",
    source: "openalex",
    sourceRecordId: work.id || "",
    title: work.title || "",
    abstractText: decodeInvertedIndex(work.abstract_inverted_index),
    doi: work.doi || "",
    authors,
    firstAuthor: authors[0] || "",
    language: work.language || "",
    license,
    isOpenAccess: Boolean(work?.open_access?.is_oa),
    publicationYear: work.publication_year || null,
    publicationDate: work.publication_date || "",
    citedByCount: work.cited_by_count || 0,
    type: work.type || "",
    journal: source?.display_name || "",
    journalIssnL: source?.issn_l || "",
    hostOrganization: source?.host_organization_name || "",
    sourceUrl: work.primary_location?.landing_page_url || work.primary_location?.pdf_url || "",
    fetchedAt: new Date().toISOString(),
  };
}

function buildFilterQuery(queryConfig) {
  const filters = [];
  const q = (queryConfig.query || "").trim();
  // Put the search term inside `filter` as default.search. Using the top-level
  // `search=` param together with `filter=` makes OpenAlex switch to a
  // fulltext search that returns 0 results; default.search keeps metadata
  // (title/abstract) search and composes correctly with the other clauses.
  if (q) filters.push(`default.search:${q}`);
  if (queryConfig.fromYear) filters.push(`from_publication_date:${queryConfig.fromYear}-01-01`);
  if (queryConfig.toYear) filters.push(`to_publication_date:${queryConfig.toYear}-12-31`);
  if (queryConfig.openAccessOnly !== false) filters.push("is_oa:true");
  // `journal-article` is not a real OpenAlex type value and silently yields 0
  // results. The correct value is `article`; journal-article focus is enforced
  // downstream by the quality gates (DOI, source type, etc.).
  filters.push("type:article");
  if (queryConfig.hasAbstractOnly !== false) filters.push("has_abstract:true");
  return filters.join(",");
}

function stableSort(records) {
  return records.sort((a, b) => {
    const keyA = `${a.publicationYear || 0}|${a.doi || ""}|${a.id}`;
    const keyB = `${b.publicationYear || 0}|${b.doi || ""}|${b.id}`;
    return keyA.localeCompare(keyB);
  });
}

export async function fetchOpenAlexRecords(queryConfig, fetchOptions = {}) {
  const perPage = Math.min(Math.max(queryConfig.perPage || 100, 1), 200);
  const pages = Math.max(queryConfig.pages || 1, 1);
  const timeoutMs = fetchOptions.timeoutMs ?? 25_000;
  const records = [];

  const filter = buildFilterQuery(queryConfig);
  const requests = [];
  for (let page = 1; page <= pages; page++) {
    const url = new URL(OPENALEX_BASE_URL);
    url.searchParams.set("filter", filter);
    url.searchParams.set("per-page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "publication_year:desc");
    url.searchParams.set("mailto", "admin@stealthhumanizer.com");
    requests.push(url.toString());
  }

  for (const requestUrl of requests) {
    // OpenAlex's free/polite pool caps around 1000 credits/day. On HTTP 429 we
    // honour Retry-After and back off so a long multi-day ingest degrades
    // gracefully instead of crashing or silently collecting empty pages.
    for (let attempt = 0; attempt < 4; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(requestUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("retry-after")) || 30 * (attempt + 1);
          clearTimeout(timer);
          await new Promise((r) => setTimeout(r, Math.min(retryAfter, 120) * 1000));
          continue;
        }
        if (!res.ok) {
          throw new Error(`OpenAlex request failed (${res.status}) for ${requestUrl}`);
        }
        const payload = await res.json();
        const mapped = Array.isArray(payload.results) ? payload.results.map(mapOpenAlexWork) : [];
        records.push(...mapped);
        break;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return stableSort(records);
}
