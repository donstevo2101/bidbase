/**
 * Apify API client for BidBase.
 * Uses Apify actors for reliable web scraping — handles JavaScript-rendered
 * pages, anti-bot protection, and structured data extraction.
 */

const APIFY_TOKEN = process.env['APIFY_TOKEN'];
const APIFY_BASE = 'https://api.apify.com/v2';

if (!APIFY_TOKEN) {
  console.warn('APIFY_TOKEN not set — Apify scraping unavailable, falling back to basic fetch');
}

interface ApifyRunResult {
  items: Record<string, unknown>[];
}

/**
 * Run an Apify actor and wait for results.
 * @param actorId - Actor ID (e.g. 'apify/web-scraper')
 * @param input - Actor input configuration
 * @param timeoutSecs - Max wait time (default 120s)
 */
export async function runApifyActor(
  actorId: string,
  input: Record<string, unknown>,
  timeoutSecs = 120
): Promise<ApifyRunResult> {
  if (!APIFY_TOKEN) {
    throw new Error('APIFY_TOKEN not configured');
  }

  // Start the actor run
  const startRes = await fetch(`${APIFY_BASE}/acts/${actorId}/runs?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Apify actor start failed: ${startRes.status} ${err}`);
  }

  const runData = await startRes.json() as { data: { id: string; status: string; defaultDatasetId: string } };
  const runId = runData.data.id;
  const datasetId = runData.data.defaultDatasetId;

  // Poll for completion
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutSecs * 1000) {
    await new Promise((r) => setTimeout(r, 3000)); // Poll every 3s

    const statusRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const statusData = await statusRes.json() as { data: { status: string } };

    if (statusData.data.status === 'SUCCEEDED') {
      // Fetch results from dataset
      const resultsRes = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${APIFY_TOKEN}&format=json`);
      const items = await resultsRes.json() as Record<string, unknown>[];
      return { items };
    }

    if (statusData.data.status === 'FAILED' || statusData.data.status === 'ABORTED') {
      throw new Error(`Apify actor run ${statusData.data.status}`);
    }
  }

  throw new Error('Apify actor run timed out');
}

/**
 * Scrape a single URL using Apify's web scraper.
 * Returns the page's text content and any structured data found.
 */
export async function scrapeUrl(url: string): Promise<{ text: string; title: string; url: string }> {
  if (!APIFY_TOKEN) {
    // Fallback to basic fetch
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return { text, title: titleMatch?.[1]?.trim() ?? '', url };
  }

  const result = await runApifyActor('apify~web-scraper', {
    startUrls: [{ url }],
    pageFunction: `async function pageFunction(context) {
      const { page, request } = context;
      const title = await page.title();
      const text = await page.evaluate(() => document.body.innerText);
      return { url: request.url, title, text };
    }`,
    maxRequestsPerCrawl: 1,
    maxConcurrency: 1,
  }, 60);

  const item = result.items[0];
  return {
    text: (item?.['text'] as string) ?? '',
    title: (item?.['title'] as string) ?? '',
    url: (item?.['url'] as string) ?? url,
  };
}

/**
 * Scrape Google search results using Apify's Google Search actor.
 */
export async function searchGoogle(query: string, maxResults = 10): Promise<Array<{ title: string; url: string; snippet: string }>> {
  if (!APIFY_TOKEN) {
    // Fallback to DuckDuckGo
    const { searchWeb } = await import('./scraper.js');
    return searchWeb(query);
  }

  const result = await runApifyActor('apify~google-search-scraper', {
    queries: query,
    maxPagesPerQuery: 1,
    resultsPerPage: maxResults,
    languageCode: 'en',
    countryCode: 'gb',
  }, 60);

  return result.items
    .filter((item) => item['organicResults'])
    .flatMap((item) => {
      const results = item['organicResults'] as Array<{ title: string; url: string; description: string }>;
      return results.map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.description ?? '',
      }));
    })
    .slice(0, maxResults);
}

/**
 * Scrape LinkedIn company page using Apify.
 */
export async function scrapeLinkedIn(companyName: string): Promise<{
  url: string;
  name: string;
  description: string;
  industry: string;
  employeeCount: string;
  website: string;
} | null> {
  if (!APIFY_TOKEN) return null;

  try {
    const result = await runApifyActor('apify~linkedin-company-scraper', {
      searchQueries: [companyName],
      maxResults: 1,
    }, 90);

    const item = result.items[0];
    if (!item) return null;

    return {
      url: (item['linkedinUrl'] as string) ?? (item['url'] as string) ?? '',
      name: (item['name'] as string) ?? '',
      description: (item['description'] as string) ?? '',
      industry: (item['industry'] as string) ?? '',
      employeeCount: (item['employeeCountRange'] as string) ?? '',
      website: (item['website'] as string) ?? '',
    };
  } catch {
    return null;
  }
}

export function isApifyAvailable(): boolean {
  return !!APIFY_TOKEN;
}
