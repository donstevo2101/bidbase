/**
 * 360Giving GrantNav funder data scraper.
 * Fetches funder listings from the GrantNav funders directory and extracts
 * structured data for each funder including grant counts, values, and dates.
 */

import { fetchPage } from '../lib/scraper.js';

export interface FunderRecord {
  name: string;
  totalGrants: number;
  grantsToOrgs: number;
  grantsToIndividuals: number;
  totalToOrgs: number;  // GBP
  totalToIndividuals: number;  // GBP
  latestAward: string | null;
  earliestAward: string | null;
  grantNavUrl: string;
}

/**
 * Parses a currency string like "£1,234,567" or "1234567" into a number.
 */
function parseCurrency(text: string): number {
  const cleaned = text.replace(/[£,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Parses a number string like "1,234" into a number.
 */
function parseCount(text: string): number {
  const cleaned = text.replace(/[,\s]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Extracts funder cards from a single GrantNav funders page HTML.
 * The page uses div cards with class "grant-search-result__funders", NOT table rows.
 */
function parseFundersPage(html: string): FunderRecord[] {
  const funders: FunderRecord[] = [];

  // Split HTML by funder card blocks
  const cards = html.split('grant-search-result grant-search-result__funders');

  for (let i = 1; i < cards.length; i++) {
    const card = cards[i]!;

    // Extract funder name and URL
    const titleMatch = card.match(/grant-search-result__title"[^>]*href="([^"]*)"[^>]*>\s*([^<]+)/i);
    if (!titleMatch) continue;

    const rawUrl = titleMatch[1]!.trim();
    const name = titleMatch[2]!.trim();
    if (!name || name.length < 2) continue;

    let grantNavUrl = rawUrl;
    if (grantNavUrl.startsWith('/')) {
      grantNavUrl = `https://grantnav.threesixtygiving.org${grantNavUrl}`;
    }

    const funder: FunderRecord = {
      name,
      totalGrants: extractBoxValue(card, 'All Grants'),
      grantsToOrgs: extractBoxValue(card, 'Grants to Organisations'),
      grantsToIndividuals: extractBoxValue(card, 'Grants to Individuals'),
      totalToOrgs: extractCurrencyValue(card, 'Total  to Organisations') || extractCurrencyValue(card, 'Total to Organisations'),
      totalToIndividuals: extractCurrencyValue(card, 'Total  to Individuals') || extractCurrencyValue(card, 'Total to Individuals'),
      latestAward: extractDateValue(card, 'Latest Award'),
      earliestAward: extractDateValue(card, 'Earliest Award'),
      grantNavUrl,
    };

    if (funder.name) {
      funders.push(funder);
    }
  }

  return funders;
}

function extractBoxValue(card: string, label: string): number {
  // Match: <strong>Label</strong> <br /> 4,403
  const pattern = new RegExp(label + '[\\s\\S]*?<\\/strong>\\s*(?:<br\\s*\\/?>)?\\s*([\\d,]+)', 'i');
  const match = card.match(pattern);
  if (match?.[1]) return parseInt(match[1].replace(/,/g, ''), 10) || 0;
  return 0;
}

function extractCurrencyValue(card: string, label: string): number {
  // Match: <strong>Label</strong><br/> <span...>£30,501,097</span>
  const pattern = new RegExp(label + '[\\s\\S]*?[£]([\\d,]+(?:\\.\\d+)?)', 'i');
  const match = card.match(pattern);
  if (match?.[1]) return parseFloat(match[1].replace(/,/g, '')) || 0;
  return 0;
}

function extractDateValue(card: string, label: string): string | null {
  const pattern = new RegExp(label + '[\\s\\S]*?<\\/strong>\\s*(?:<br\\s*\\/?>)?\\s*([A-Za-z0-9\\s,]+?)\\s*<', 'i');
  const match = card.match(pattern);
  if (match?.[1]) {
    const cleaned = match[1].trim();
    if (cleaned && cleaned.length > 3) return cleaned;
  }
  return null;
}

/**
 * Fetches all funders from the 360Giving GrantNav funders directory.
 * Paginates through all pages (starting at page 1) until no more results.
 */
export async function fetch360GivingFunders(): Promise<FunderRecord[]> {
  const allFunders: FunderRecord[] = [];
  const maxPages = 25; // Safety limit

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://grantnav.threesixtygiving.org/funders?page=${page}`;
    console.log(`[360Giving] Fetching page ${page}: ${url}`);

    try {
      const html = await fetchPage(url);

      // Check if the page has any funder data
      const pageFunders = parseFundersPage(html);

      if (pageFunders.length === 0) {
        console.log(`[360Giving] No funders found on page ${page} — stopping pagination`);
        break;
      }

      allFunders.push(...pageFunders);
      console.log(`[360Giving] Page ${page}: ${pageFunders.length} funders (total: ${allFunders.length})`);

      // Brief pause between pages to be respectful
      if (page < maxPages) {
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (err) {
      console.error(`[360Giving] Failed to fetch page ${page}:`, err instanceof Error ? err.message : err);
      // If the first page fails, throw. Otherwise stop gracefully.
      if (page === 1) {
        throw new Error(`Failed to fetch 360Giving funders: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }
  }

  console.log(`[360Giving] Completed: ${allFunders.length} funders fetched`);
  return allFunders;
}
