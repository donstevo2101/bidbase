/**
 * Continuous grant portal scraper for BidBase.
 * Scrapes multiple UK grant funding sources and returns structured opportunities.
 */

import { fetchPage, extractText, searchWeb } from '../lib/scraper.js';
import { scrapeUrl, searchGoogle, isApifyAvailable } from '../lib/apify.js';

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
  openDate?: string;
  closeDate?: string;
  status?: 'open' | 'upcoming' | 'closed';
  previousAwards?: number;
  totalApplicants?: number;
  averageAward?: string;
  sectors?: string[];
  riskScore?: number;
}

// ---- Date extraction helpers ----

interface ExtractedDates {
  openDate?: string;
  closeDate?: string;
  status?: 'open' | 'upcoming' | 'closed';
}

/**
 * Extracts opening/closing dates from page text using common UK grant patterns.
 */
function extractDatesFromText(text: string): ExtractedDates {
  const result: ExtractedDates = {};

  // Pattern: "Rolling programme" / "rolling basis" → open, no close date
  if (/rolling\s+(?:programme|basis|funding|applications?)/i.test(text)) {
    result.status = 'open';
    return result;
  }

  // Pattern: "Opens: DD Month YYYY" / "Opening date: DD Month YYYY"
  const opensMatch = text.match(
    /(?:opens?|opening\s+date|applications?\s+open)[:\s]*(\d{1,2}[\s/.-]\w+[\s/.-]\d{4})/i
  );
  if (opensMatch) {
    result.openDate = normaliseDate(opensMatch[1]);
  }

  // Pattern: "Closes: DD Month YYYY" / "Closing date: DD Month YYYY" / "Deadline: DD Month YYYY"
  const closesMatch = text.match(
    /(?:closes?|closing\s+date|deadline|applications?\s+close|submit\s+by|due\s+(?:date|by))[:\s]*(\d{1,2}[\s/.-]\w+[\s/.-]\d{4})/i
  );
  if (closesMatch) {
    result.closeDate = normaliseDate(closesMatch[1]);
  }

  // Pattern: "Application window: DD/MM/YYYY - DD/MM/YYYY"
  const windowMatch = text.match(
    /(?:application\s+window|funding\s+window|open\s+period)[:\s]*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})\s*[-–to]+\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i
  );
  if (windowMatch) {
    result.openDate = normaliseDate(windowMatch[1]);
    result.closeDate = normaliseDate(windowMatch[2]);
  }

  // Pattern: "DD Month YYYY - DD Month YYYY" (date range without label)
  if (!result.openDate && !result.closeDate) {
    const rangeMatch = text.match(
      /(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})\s*[-–to]+\s*(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})/i
    );
    if (rangeMatch) {
      result.openDate = normaliseDate(rangeMatch[1]);
      result.closeDate = normaliseDate(rangeMatch[2]);
    }
  }

  // Determine status based on dates
  if (result.openDate || result.closeDate) {
    const now = new Date();
    if (result.openDate) {
      const open = new Date(result.openDate);
      if (open > now) {
        result.status = 'upcoming';
        return result;
      }
    }
    if (result.closeDate) {
      const close = new Date(result.closeDate);
      if (close < now) {
        result.status = 'closed';
      } else {
        result.status = 'open';
      }
    } else {
      result.status = 'open';
    }
  }

  return result;
}

/**
 * Normalises a date string into ISO format (YYYY-MM-DD).
 */
function normaliseDate(raw: string): string {
  const trimmed = raw.trim();

  // Try DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const numericMatch = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (numericMatch) {
    const day = numericMatch[1].padStart(2, '0');
    const month = numericMatch[2].padStart(2, '0');
    const year = numericMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Try DD Month YYYY
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().split('T')[0];
  }

  return trimmed;
}

/**
 * Extracts sector/focus area keywords from grant text.
 */
function extractSectors(text: string): string[] {
  const sectorKeywords = [
    'health', 'education', 'youth', 'arts', 'culture', 'environment', 'climate',
    'housing', 'homelessness', 'mental health', 'disability', 'sport', 'community',
    'employment', 'skills', 'training', 'digital', 'rural', 'urban', 'poverty',
    'food', 'wellbeing', 'children', 'elderly', 'veterans', 'refugees',
    'social enterprise', 'social care', 'criminal justice', 'heritage',
  ];
  const lower = text.toLowerCase();
  return sectorKeywords.filter((kw) => lower.includes(kw));
}

/**
 * Extracts award/applicant statistics from grant text.
 */
function extractStats(text: string): { previousAwards?: number; totalApplicants?: number; averageAward?: string } {
  const result: { previousAwards?: number; totalApplicants?: number; averageAward?: string } = {};

  const awardsMatch = text.match(/(\d[\d,]*)\s*(?:awards?|grants?)\s*(?:made|given|awarded|distributed)/i);
  if (awardsMatch) {
    result.previousAwards = parseInt(awardsMatch[1].replace(/,/g, ''), 10);
  }

  const applicantsMatch = text.match(/(\d[\d,]*)\s*(?:applicants?|applications?\s+received)/i);
  if (applicantsMatch) {
    result.totalApplicants = parseInt(applicantsMatch[1].replace(/,/g, ''), 10);
  }

  const avgMatch = text.match(/(?:average|typical)\s+(?:award|grant)\s*(?:of|:)?\s*[£]?([\d,]+)/i);
  if (avgMatch) {
    result.averageAward = `£${avgMatch[1]}`;
  }

  return result;
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
    scrapeWebSearchGrants(now),
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
      const snippetDates = extractDatesFromText(result.snippet ?? '');
      const snippetSectors = extractSectors(result.snippet ?? '');

      opportunities.push({
        title: result.title,
        funder: extractFunderFromTitle(result.title),
        url: result.url,
        description: result.snippet,
        source: 'duckduckgo_search',
        scrapedAt: now,
        openDate: snippetDates.openDate,
        closeDate: snippetDates.closeDate,
        status: snippetDates.status ?? 'open',
        sectors: snippetSectors.length > 0 ? snippetSectors : undefined,
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
    // Use Apify for JS-rendered content if available
    let text: string;
    if (isApifyAvailable()) {
      const result = await scrapeUrl('https://www.tnlcommunityfund.org.uk/funding/programmes');
      text = result.text;
    } else {
      const html = await fetchPage('https://www.tnlcommunityfund.org.uk/funding/programmes');
      text = await extractText(html);
    }

    const sections = text.split(/\n\n+/);

    for (const section of sections) {
      if (section.length < 40) continue;

      const titleMatch = section.match(/^([A-Z][^\n]{10,80})/);
      if (!titleMatch) continue;

      const title = titleMatch[1].trim();
      if (title.match(/^(Menu|Home|About|Contact|Cookie|Privacy|Footer|Skip|Search|Sign|Log|Back|Close|Subscribe|Newsletter)/i)) continue;

      const amountMatch = section.match(/[£][\d,]+(?:\s*(?:to|[-–])\s*[£]?[\d,]+)?/);
      const deadlineMatch = section.match(/(?:deadline|closes?|closing date)[:\s]*([^\n.]+)/i);
      const dates = extractDatesFromText(section);
      const stats = extractStats(section);
      const sectors = extractSectors(section);

      opportunities.push({
        title,
        funder: 'The National Lottery Community Fund',
        url: 'https://www.tnlcommunityfund.org.uk/funding/programmes',
        amount: amountMatch ? amountMatch[0] : undefined,
        deadline: deadlineMatch ? deadlineMatch[1].trim() : dates.closeDate,
        description: section.slice(0, 300).trim(),
        source: 'tnl_community_fund',
        scrapedAt: now,
        openDate: dates.openDate,
        closeDate: dates.closeDate ?? (deadlineMatch ? deadlineMatch[1].trim() : undefined),
        status: dates.status ?? 'open',
        previousAwards: stats.previousAwards,
        totalApplicants: stats.totalApplicants,
        averageAward: stats.averageAward,
        sectors: sectors.length > 0 ? sectors : undefined,
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
    const dates = extractDatesFromText(section);
    const stats = extractStats(section);
    const sectors = extractSectors(section);

    opportunities.push({
      title,
      funder: 'UK Government',
      url: 'https://www.gov.uk/business-finance-support',
      amount: amountMatch ? amountMatch[0] : undefined,
      description: section.slice(0, 300).trim(),
      source: 'gov_uk',
      scrapedAt: now,
      openDate: dates.openDate,
      closeDate: dates.closeDate,
      status: dates.status ?? 'open',
      previousAwards: stats.previousAwards,
      totalApplicants: stats.totalApplicants,
      averageAward: stats.averageAward,
      sectors: sectors.length > 0 ? sectors : undefined,
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
        const blockText = block.replace(/<[^>]+>/g, ' ');
        const dates = extractDatesFromText(blockText);
        const stats = extractStats(blockText);
        const sectors = extractSectors(blockText);

        opportunities.push({
          title: titleMatch[1].trim(),
          funder: funderMatch ? funderMatch[1].trim() : 'Unknown',
          url: urlMatch ? `https://grantnav.threesixtygiving.org${urlMatch[1]}` : 'https://grantnav.threesixtygiving.org',
          amount: amountMatch ? amountMatch[0] : undefined,
          deadline: dateMatch ? dateMatch[0] : dates.closeDate,
          source: '360giving_grantnav',
          scrapedAt: now,
          openDate: dates.openDate,
          closeDate: dates.closeDate ?? (dateMatch ? dateMatch[0] : undefined),
          status: dates.status ?? 'open',
          previousAwards: stats.previousAwards,
          totalApplicants: stats.totalApplicants,
          averageAward: stats.averageAward,
          sectors: sectors.length > 0 ? sectors : undefined,
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

      const dates = extractDatesFromText(section);
      const stats = extractStats(section);
      const sectors = extractSectors(section);

      opportunities.push({
        title,
        funder: extractFunderFromTitle(title),
        url: 'https://www.charityexcellence.co.uk/Home/BlogDetail?PostId=139',
        amount: amountMatch ? amountMatch[0] : undefined,
        deadline: deadlineMatch ? deadlineMatch[1].trim() : dates.closeDate,
        description: section.slice(0, 300).trim(),
        eligibility: extractEligibility(section),
        source: 'charity_excellence',
        scrapedAt: now,
        openDate: dates.openDate,
        closeDate: dates.closeDate ?? (deadlineMatch ? deadlineMatch[1].trim() : undefined),
        status: dates.status ?? 'open',
        previousAwards: stats.previousAwards,
        totalApplicants: stats.totalApplicants,
        averageAward: stats.averageAward,
        sectors: sectors.length > 0 ? sectors : undefined,
      });

      if (opportunities.length >= 15) break;
    }
  } catch (err) {
    console.error('[GrantScraper] Charity Excellence scrape failed:', err instanceof Error ? err.message : err);
  }

  return opportunities;
}

async function scrapeWebSearchGrants(now: string): Promise<GrantOpportunity[]> {
  const opportunities: GrantOpportunity[] = [];

  try {
    // Use Apify Google Search if available, otherwise DuckDuckGo
    const query = '"grant funding" "now open" UK CIC OR charity OR "social enterprise" 2026';
    const results = isApifyAvailable()
      ? await searchGoogle(query, 15)
      : await searchWeb(query);

    for (const result of results.slice(0, 15)) {
      const snippetDates = extractDatesFromText(result.snippet ?? '');
      const snippetSectors = extractSectors(result.snippet ?? '');

      opportunities.push({
        title: result.title,
        funder: extractFunderFromTitle(result.title),
        url: result.url,
        description: result.snippet,
        source: isApifyAvailable() ? 'google_search' : 'duckduckgo_search',
        scrapedAt: now,
        openDate: snippetDates.openDate,
        closeDate: snippetDates.closeDate,
        status: snippetDates.status ?? 'open',
        sectors: snippetSectors.length > 0 ? snippetSectors : undefined,
      });
    }
  } catch (err) {
    console.error('[GrantScraper] Web search grants failed:', err instanceof Error ? err.message : err);
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
