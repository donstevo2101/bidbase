/**
 * Core web scraping utilities for BidBase data enrichment.
 * Uses Node built-in fetch — no external scraping dependencies.
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Fetches a URL and returns the HTML body.
 * Handles timeouts (10s) and retries (2 attempts) with user-agent spoofing.
 */
export async function fetchPage(url: string): Promise<string> {
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        // Brief pause before retry
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${maxAttempts} attempts: ${lastError?.message}`);
}

/**
 * Strips HTML tags and returns clean text.
 * Regex-based approach — no external dependency.
 */
export async function extractText(html: string): Promise<string> {
  let text = html;

  // Remove script and style blocks entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Replace block-level tags with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr|blockquote|section|article|header|footer)[\s>]/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&pound;/g, '£')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.trim();

  return text;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Searches the web using DuckDuckGo's HTML endpoint.
 * Parses results from the HTML response.
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const html = await fetchPage(`https://html.duckduckgo.com/html/?q=${encodedQuery}`);

    const results: SearchResult[] = [];

    // DuckDuckGo HTML results are in <div class="result"> blocks
    // Each contains <a class="result__a"> for title/url and <a class="result__snippet"> for snippet
    const resultBlocks = html.match(/<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*result[^"]*"|$)/gi);

    if (!resultBlocks) {
      return [];
    }

    for (const block of resultBlocks) {
      // Extract title and URL from result__a link
      const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      // Extract snippet from result__snippet
      const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

      if (titleMatch) {
        let url = titleMatch[1];
        // DuckDuckGo wraps URLs in redirect — extract the actual URL
        const uddgMatch = url.match(/[?&]uddg=([^&]+)/);
        if (uddgMatch) {
          url = decodeURIComponent(uddgMatch[1]);
        }

        const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
        const snippet = snippetMatch
          ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
          : '';

        if (title && url) {
          results.push({ title, url, snippet });
        }
      }

      // Cap at 10 results
      if (results.length >= 10) break;
    }

    return results;
  } catch (err) {
    console.error('[Scraper] Web search failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
