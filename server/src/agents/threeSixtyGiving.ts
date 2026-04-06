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
 * Extracts funder rows from a single GrantNav funders page HTML.
 * The GrantNav funders page uses a table with columns:
 * Funder | Grants | To Organisations | To Individuals | Total to Organisations | Total to Individuals | Latest Award | Earliest Award
 */
function parseFundersPage(html: string): FunderRecord[] {
  const funders: FunderRecord[] = [];

  // Find table rows — each funder is a <tr> in the main table body
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const row = rowMatch[1];

    // Extract all <td> cells
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellPattern.exec(row)) !== null) {
      // Strip HTML tags from cell content
      const cellText = cellMatch[1].replace(/<[^>]+>/g, '').trim();
      cells.push(cellText);
    }

    // Need at least 8 columns for a valid funder row
    if (cells.length < 8) continue;

    // Skip header rows (check if first cell looks like a header)
    if (cells[0].toLowerCase().includes('funder') && cells[1].toLowerCase().includes('grant')) continue;

    // Extract the funder link URL from the first cell
    const linkMatch = rowMatch[1].match(/<a[^>]*href="([^"]*)"[^>]*>/i);
    let grantNavUrl = '';
    if (linkMatch) {
      grantNavUrl = linkMatch[1];
      if (grantNavUrl.startsWith('/')) {
        grantNavUrl = `https://grantnav.threesixtygiving.org${grantNavUrl}`;
      }
    }

    // Extract the funder name from the link text or first cell
    const nameMatch = rowMatch[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : cells[0];

    if (!name || name.length < 2) continue;

    const funder: FunderRecord = {
      name,
      totalGrants: parseCount(cells[1]),
      grantsToOrgs: parseCount(cells[2]),
      grantsToIndividuals: parseCount(cells[3]),
      totalToOrgs: parseCurrency(cells[4]),
      totalToIndividuals: parseCurrency(cells[5]),
      latestAward: cells[6] || null,
      earliestAward: cells[7] || null,
      grantNavUrl,
    };

    // Only include if we got a meaningful name and at least some data
    if (funder.name && (funder.totalGrants > 0 || funder.totalToOrgs > 0)) {
      funders.push(funder);
    }
  }

  return funders;
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
