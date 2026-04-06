/**
 * Continuous grant portal scraper for BidBase.
 * Scrapes multiple UK grant funding sources and returns structured opportunities.
 */

import { fetchPage, extractText, searchWeb } from '../lib/scraper.js';

// ---- Types ----

export interface GrantOpportunity {
  title: string;
  funder: string;
  url: string;
  amount?: string;
  deadline?: string;
  eligibility?: string;
  description?: string;
  source: string;
  scrapedAt: string;
}

// ---- Exported functions ----

/**
 * Scrapes all configured grant portals and returns combined results.
 */
export async function scrapeGrantPortals(): Promise<GrantOpportunity[]> {
  const now = new Date().toISOString();
  const allOpportunities: GrantOpportunity[] = [];

  // Run all scrapers in parallel — each is fault-tolerant
  const results = await Promise.allSettled([
    scrapeNationalLottery(now),
    scrapeGovUkGrants(now),
    scrapeGrantNav(now),
    scrapeCharityExcellence(now),
    scrapeDuckDuckGoGrants(now),
  ]);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allOpportunities.push(...result.value);
    } else {
      console.error('[GrantScraper] Source failed:', result.reason);
    }
  }

  return deduplicateOpportunities(allOpportunities);
}

/**
 * Searches for grant opportunities matching a specific client profile.
 */
export async function searchGrantsForClient(
  clientType: string,
  geography: string,
  sector?: string
): Promise<GrantOpportunity[]> {
  const now = new Date().toISOString();
  const opportunities: GrantOpportunity[] = [];

  // Build targeted search queries
  const typeTerms: Record<string, string> = {
    CIC: 'community interest company CIC',
    charity: 'charity registered charity',
    social_enterprise: 'social enterprise',
    unincorporated: 'community group unincorporated',
  };

  const typeQuery = typeTerms[clientType] ?? clientType;
  const sectorQuery = sector ? ` ${sector}` : '';

  // Search GrantNav with client-specific terms
  try {
    const grantNavQuery = `${typeQuery} ${geography}${sectorQuery}`;
    const grantNavUrl = `https://grantnav.threesixtygiving.org/search?query=${encodeURIComponent(grantNavQuery)}`;
    const html = await fetchPage(grantNavUrl);
    const grants = await parseGrantNavPage(html, now);
    opportunities.push(...grants);
  } catch (err) {
    console.error('[GrantScraper] GrantNav client search failed:', err instanceof Error ? err.message : err);
  }

  // Search via DuckDuckGo for open grants
  try {
    const searchQuery = `"grant funding" "now open" UK ${typeQuery} ${geography}${sectorQuery} 2026`;
    const results = await searchWeb(searchQuery);
    for (const result of results.slice(0, 8)) {
      opportunities.push({
        title: result.title,
        funder: extractFunderFromTitle(result.title),
        url: result.url,
        description: result.snippet,
        source: 'duckduckgo_search',
        scrapedAt: now,
      });
    }
  } catch (err) {
    console.error('[GrantScraper] DuckDuckGo client search failed:', err instanceof Error ? err.message : err);
  }

  // Search Gov.uk grants
  try {
    const govQuery = `${typeQuery} ${geography}${sectorQuery}`;
    const govUrl = `https://www.gov.uk/business-finance-support?q=${encodeURIComponent(govQuery)}`;
    const html = await fetchPage(govUrl);
    const grants = await parseGovUkPage(html, now);
    opportunities.push(...grants);
  } catch (err) {
    console.error('[GrantScraper] Gov.uk client search failed:', err instanceof Error ? err.message : err);
  }

  return deduplicateOpportunities(opportunities);
}

// ---- Individual source scrapers ----

async function scrapeNationalLottery(now: string): Promise<GrantOpportunity[]> {
  const opportunities: GrantOpportunity[] = [];

  try {
    const html = await fetchPage('https://www.tnlcommunityfund.org.uk/funding');
    const text = await extractText(html);

    // Parse funding programmes from the page text
    const sections = text.split(/\n\n+/);

    for (const section of sections) {
      // Look for sections that describe funding programmes
      if (section.length < 30) continue;

      const titleMatch = section.match(/^([A-Z][^\n]{10,80})/);
      if (!titleMatch) continue;

      const title = titleMatch[1].trim();

      // Skip navigation/footer items
      if (title.match(/^(Menu|Home|About|Contact|Cookie|Privacy|Footer)/i)) continue;

      const amountMatch = section.match(/[£][\d,]+(?:\s*(?:to|[-–])\s*[£]?[\d,]+)?/);
      const deadlineMatch = section.match(
        /(?:deadline|closes?|closing date)[:\s]*([^\n.]+)/i
      );

      opportunities.push({
        title,
        funder: 'The National Lottery Community Fund',
        url: 'https://www.tnlcommunityfund.org.uk/funding',
        amount: amountMatch ? amountMatch[0] : undefined,
        deadline: deadlineMatch ? deadlineMatch[1].trim() : undefined,
        description: section.slice(0, 300).trim(),
        source: 'tnl_community_fund',
        scrapedAt: now,
      });

      if (opportunities.length >= 15) break;
    }
  } catch (err) {
    console.error('[GrantScraper] National Lottery scrape failed:', err instanceof Error ? err.message : err);
  }

  return opportunities;
}

async function scrapeGovUkGrants(now: string): Promise<GrantOpportunity[]> {
  const opportunities: GrantOpportunity[] = [];

  try {
    const html = await fetchPage('https://www.gov.uk/business-finance-support');
    const grants = await parseGovUkPage(html, now);
    opportunities.push(...grants);
  } catch (err) {
    console.error('[GrantScraper] Gov.uk scrape failed:', err instanceof Error ? err.message : err);
  }

  return opportunities;
}

async function parseGovUkPage(html: string, now: string): Promise<GrantOpportunity[]> {
  const opportunities: GrantOpportunity[] = [];
  const text = await extractText(html);
  const sections = text.split(/\n\n+/);

  for (const section of sections) {
    if (section.length < 30) continue;

    const titleMatch = section.match(/^([A-Z][^\n]{10,100})/);
    if (!titleMatch) continue;

    const title = titleMatch[1].trim();
    if (title.match(/^(Menu|Home|Skip|Cookie|Privacy|Footer|Search|Filter)/i)) continue;

    const amountMatch = section.match(/[£][\d,]+(?:\s*(?:to|[-–])\s*[£]?[\d,]+)?/);

    opportunities.push({
      title,
      funder: 'UK Government',
      url: 'https://www.gov.uk/business-finance-support',
      amount: amountMatch ? amountMatch[0] : undefined,
      description: section.slice(0, 300).trim(),
      source: 'gov_uk',
      scrapedAt: now,
    });

    if (opportunities.length >= 15) break;
  }

  return opportunities;
}

async function scrapeGrantNav(now: string): Promise<GrantOpportunity[]> {
  const opportunities: GrantOpportunity[] = [];

  try {
    const html = await fetchPage(
      'https://grantnav.threesixtygiving.org/search?query=community+funding+UK'
    );
    const grants = await parseGrantNavPage(html, now);
    opportunities.push(...grants);
  } catch (err) {
    console.error('[GrantScraper] GrantNav scrape failed:', err instanceof Error ? err.message : err);
  }

  return opportunities;
}

async function parseGrantNavPage(html: string, now: string): Promise<GrantOpportunity[]> {
  const opportunities: GrantOpportunity[] = [];

  // GrantNav uses specific HTML structure — parse grant result blocks directly from HTML
  // Each grant result has a title, funder, amount, and date
  const grantBlocks = html.match(/<div class="grant-result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];

  if (grantBlocks.length > 0) {
    for (const block of grantBlocks.slice(0, 15)) {
      const titleMatch = block.match(/<h3[^>]*>([^<]+)<\/h3>/i) ?? block.match(/<a[^>]*>([^<]{10,})<\/a>/i);
      const amountMatch = block.match(/[£][\d,]+(?:\.?\d{0,2})?/);
      const funderMatch = block.match(/(?:funder|funded by|from)[:\s]*([^<\n]{5,80})/i);
      const dateMatch = block.match(/\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}/i);
      const urlMatch = block.match(/href="([^"]*grant[^"]*)"/i);

      if (titleMatch) {
        opportunities.push({
          title: titleMatch[1].trim(),
          funder: funderMatch ? funderMatch[1].trim() : 'Unknown',
          url: urlMatch ? `https://grantnav.threesixtygiving.org${urlMatch[1]}` : 'https://grantnav.threesixtygiving.org',
          amount: amountMatch ? amountMatch[0] : undefined,
          deadline: dateMatch ? dateMatch[0] : undefined,
          source: '360giving_grantnav',
          scrapedAt: now,
        });
      }
    }
  }

  // Fallback: if no structured blocks found, try the JSON-LD or search result links
  if (opportunities.length === 0) {
    const linkMatches = html.matchAll(/<a[^>]*href="(\/grant\/[^"]+)"[^>]*>([^<]{10,100})<\/a>/gi);
    for (const match of linkMatches) {
      if (opportunities.length >= 15) break;
      const url = match[1] ?? '';
      const title = match[2] ?? '';
      if (title && !title.match(/^(Search|Filter|Sort|Page|Next|Prev|Home|About)/i)) {
        opportunities.push({
          title: title.trim(),
          funder: 'Unknown',
          url: `https://grantnav.threesixtygiving.org${url}`,
          source: '360giving_grantnav',
          scrapedAt: now,
        });
      }
    }
  }

  return opportunities;
}

async function scrapeCharityExcellence(now: string): Promise<GrantOpportunity[]> {
  const opportunities: GrantOpportunity[] = [];

  try {
    const html = await fetchPage(
      'https://www.charityexcellence.co.uk/Home/BlogDetail?PostId=139'
    );
    const text = await extractText(html);

    // Charity Excellence lists grants in a blog-style format
    const sections = text.split(/\n\n+/);

    for (const section of sections) {
      if (section.length < 30) continue;

      // Look for grant-like entries
      const amountMatch = section.match(/[£][\d,]+(?:\s*(?:to|[-–])\s*[£]?[\d,]+)?/);
      const deadlineMatch = section.match(/(?:deadline|closes?)[:\s]*([^\n.]+)/i);

      const titleMatch = section.match(/^([A-Z][^\n]{10,100})/);
      if (!titleMatch) continue;

      const title = titleMatch[1].trim();
      if (title.match(/^(Menu|Home|Cookie|Privacy|Footer|Share|Comment)/i)) continue;

      opportunities.push({
        title,
        funder: extractFunderFromTitle(title),
        url: 'https://www.charityexcellence.co.uk/Home/BlogDetail?PostId=139',
        amount: amountMatch ? amountMatch[0] : undefined,
        deadline: deadlineMatch ? deadlineMatch[1].trim() : undefined,
        description: section.slice(0, 300).trim(),
        eligibility: extractEligibility(section),
        source: 'charity_excellence',
        scrapedAt: now,
      });

      if (opportunities.length >= 15) break;
    }
  } catch (err) {
    console.error('[GrantScraper] Charity Excellence scrape failed:', err instanceof Error ? err.message : err);
  }

  return opportunities;
}

async function scrapeDuckDuckGoGrants(now: string): Promise<GrantOpportunity[]> {
  const opportunities: GrantOpportunity[] = [];

  try {
    const results = await searchWeb(
      '"grant funding" "now open" UK CIC OR charity OR "social enterprise" 2026'
    );

    for (const result of results.slice(0, 10)) {
      opportunities.push({
        title: result.title,
        funder: extractFunderFromTitle(result.title),
        url: result.url,
        description: result.snippet,
        source: 'duckduckgo_search',
        scrapedAt: now,
      });
    }
  } catch (err) {
    console.error('[GrantScraper] DuckDuckGo grants search failed:', err instanceof Error ? err.message : err);
  }

  return opportunities;
}

// ---- Helpers ----

function extractFunderFromTitle(title: string): string {
  // Try to extract a funder name from common title patterns
  // e.g. "Big Lottery Fund — Community Grants" -> "Big Lottery Fund"
  const separators = /\s*[|\-–—:]\s*/;
  const parts = title.split(separators);
  if (parts.length > 1) {
    return parts[0].trim();
  }
  return title.trim().slice(0, 60);
}

function extractEligibility(text: string): string | undefined {
  const eligMatch = text.match(
    /(?:eligib(?:le|ility)|who can apply|open to)[:\s]*([^\n.]{10,200})/i
  );
  return eligMatch ? eligMatch[1].trim() : undefined;
}

const JUNK_PATTERNS = /^(menu|home|skip|cookie|privacy|footer|search|filter|sort|page|next|prev|about|contact|sign|log|back|close|share|comment|subscribe|newsletter|loading|read more|learn more|view all|see all|show more|our guide|data quality|titles & descriptions|grant programme titles)/i;

function deduplicateOpportunities(opportunities: GrantOpportunity[]): GrantOpportunity[] {
  const seen = new Set<string>();
  return opportunities.filter((opp) => {
    // Filter out navigation junk
    if (JUNK_PATTERNS.test(opp.title)) return false;
    if (opp.title.length < 15) return false;
    if (opp.funder === 'Unknown' && !opp.amount && !opp.deadline && (!opp.description || opp.description.length < 50)) return false;

    const key = opp.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
