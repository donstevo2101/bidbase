/**
 * BidBase Comprehensive UK Grant Discovery Engine
 * ================================================
 * Scrapes 17+ UK grant funding sources in parallel, extracting structured
 * grant opportunity data for CICs, charities, social enterprises, and
 * community organisations.
 *
 * Sources: Action Together, GrantMatch, KVA, TNLCF, 360Giving, GOV.UK,
 * Charity Excellence, Manchester Community Central, Community Works,
 * In Kind Direct, Community Links Bromley, Rural Services Network,
 * CF Merseyside, Supporting Communities NI, fundsforNGOs, Grants Online,
 * Google/DuckDuckGo search (5 targeted queries).
 */

import { fetchPage, extractText, searchWeb } from '../lib/scraper.js';
import { scrapeUrl, searchGoogle, isApifyAvailable } from '../lib/apify.js';

// ============================================================================
// Types
// ============================================================================

export interface GrantOpportunity {
  title: string;
  funder: string;
  url: string;
  amount?: string;
  amountMin?: number;
  amountMax?: number;
  openDate?: string;
  closeDate?: string;
  deadline?: string;
  status?: 'open' | 'upcoming' | 'closed';
  eligibility?: string;
  eligibleTypes?: string[];
  description?: string;
  sectors?: string[];
  geography?: string;
  previousAwards?: number;
  totalApplicants?: number;
  averageAward?: string;
  riskScore?: number;
  source: string;
  scrapedAt: string;
}

interface ExtractedDates {
  openDate?: string;
  closeDate?: string;
  status?: 'open' | 'upcoming' | 'closed';
}

interface ExtractedAmounts {
  raw?: string;
  min?: number;
  max?: number;
}

interface SourceResult {
  source: string;
  grants: GrantOpportunity[];
  error?: string;
  durationMs: number;
}

// ============================================================================
// Source registry
// ============================================================================

const SCRAPE_SOURCES = [
  'action_together',
  'grantmatch',
  'kingston_voluntary_action',
  'tnl_community_fund',
  '360giving_grantnav',
  'gov_uk',
  'charity_excellence',
  'manchester_community_central',
  'community_works',
  'inkind_direct',
  'community_links_bromley',
  'rural_services_network',
  'cf_merseyside',
  'supporting_communities_ni',
  'google_search',
  'fundsforngos',
  'grants_online',
] as const;

// ============================================================================
// Text parsing helpers
// ============================================================================

const MONTH_NAMES = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
/**
 * Extracts pound-sterling amounts from text and returns raw string + min/max numbers.
 */
function extractAmounts(text: string): ExtractedAmounts {
  const result: ExtractedAmounts = {};

  // Pattern: "£5,000 to £50,000" or "£5,000 - £50,000" or "£5k - £50k"
  const rangeMatch = text.match(
    /£([\d,]+(?:\.\d{1,2})?)\s*(?:k)?\s*(?:to|[-–])\s*£?([\d,]+(?:\.\d{1,2})?)\s*(?:k)?/i
  );
  if (rangeMatch) {
    let minVal = parseFloat(rangeMatch[1].replace(/,/g, ''));
    let maxVal = parseFloat(rangeMatch[2].replace(/,/g, ''));
    // Handle "k" suffix
    if (/£[\d,]+k/i.test(text)) {
      if (minVal < 1000) minVal *= 1000;
      if (maxVal < 1000) maxVal *= 1000;
    }
    result.min = minVal;
    result.max = maxVal;
    result.raw = rangeMatch[0];
    return result;
  }

  // Pattern: "up to £50,000"
  const upToMatch = text.match(/up\s+to\s+£([\d,]+(?:\.\d{1,2})?)\s*(?:k)?/i);
  if (upToMatch) {
    let val = parseFloat(upToMatch[1].replace(/,/g, ''));
    if (/k/i.test(upToMatch[0]) && val < 1000) val *= 1000;
    result.max = val;
    result.raw = upToMatch[0];
    return result;
  }

  // Pattern: "over £10,000" or "from £10,000" or "minimum £10,000"
  const fromMatch = text.match(/(?:over|from|minimum|min)\s+£([\d,]+(?:\.\d{1,2})?)\s*(?:k)?/i);
  if (fromMatch) {
    let val = parseFloat(fromMatch[1].replace(/,/g, ''));
    if (/k/i.test(fromMatch[0]) && val < 1000) val *= 1000;
    result.min = val;
    result.raw = fromMatch[0];
    return result;
  }

  // Pattern: single amount "£50,000"
  const singleMatch = text.match(/£([\d,]+(?:\.\d{1,2})?)\s*(?:k)?(?:\s*(?:million|m))?/i);
  if (singleMatch) {
    let val = parseFloat(singleMatch[1].replace(/,/g, ''));
    if (/million|m\b/i.test(singleMatch[0])) val *= 1_000_000;
    else if (/k\b/i.test(singleMatch[0]) && val < 1000) val *= 1000;
    result.min = val;
    result.max = val;
    result.raw = singleMatch[0];
    return result;
  }

  return result;
}

/**
 * Extracts opening/closing dates from text using common UK grant patterns.
 */
function extractDates(text: string): ExtractedDates {
  const result: ExtractedDates = {};

  // Rolling programme
  if (/rolling\s+(?:programme|basis|funding|applications?|deadline)/i.test(text)) {
    result.status = 'open';
    return result;
  }

  // "Opens: DD Month YYYY" / "Opening date: DD Month YYYY"
  const opensMatch = text.match(
    new RegExp(`(?:opens?|opening\\s+date|applications?\\s+open)[:\\s]*(\\d{1,2}\\s+${MONTH_NAMES}\\s+\\d{4})`, 'i')
  );
  if (opensMatch) {
    result.openDate = normaliseDate(opensMatch[1]);
  }

  // Also check numeric format opens
  if (!result.openDate) {
    const opensNumMatch = text.match(
      /(?:opens?|opening\s+date|applications?\s+open)[:\s]*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i
    );
    if (opensNumMatch) {
      result.openDate = normaliseDate(opensNumMatch[1]);
    }
  }

  // "Closes: DD Month YYYY" / "Deadline: DD Month YYYY"
  const closesMatch = text.match(
    new RegExp(`(?:closes?|closing\\s+date|deadline|applications?\\s+close|submit\\s+by|due\\s+(?:date|by))[:\\s]*(\\d{1,2}\\s+${MONTH_NAMES}\\s+\\d{4})`, 'i')
  );
  if (closesMatch) {
    result.closeDate = normaliseDate(closesMatch[1]);
  }

  if (!result.closeDate) {
    const closesNumMatch = text.match(
      /(?:closes?|closing\s+date|deadline|applications?\s+close|submit\s+by|due\s+(?:date|by))[:\s]*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i
    );
    if (closesNumMatch) {
      result.closeDate = normaliseDate(closesNumMatch[1]);
    }
  }

  // "Application window: DD/MM/YYYY - DD/MM/YYYY"
  const windowMatch = text.match(
    /(?:application\s+window|funding\s+window|open\s+period)[:\s]*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})\s*[-–to]+\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i
  );
  if (windowMatch) {
    result.openDate = normaliseDate(windowMatch[1]);
    result.closeDate = normaliseDate(windowMatch[2]);
  }

  // Date range: "DD Month YYYY - DD Month YYYY"
  if (!result.openDate && !result.closeDate) {
    const rangeMatch = text.match(
      new RegExp(`(\\d{1,2}\\s+${MONTH_NAMES}\\s+\\d{4})\\s*[-–to]+\\s*(\\d{1,2}\\s+${MONTH_NAMES}\\s+\\d{4})`, 'i')
    );
    if (rangeMatch) {
      result.openDate = normaliseDate(rangeMatch[1]);
      result.closeDate = normaliseDate(rangeMatch[2]);
    }
  }

  // Determine status
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
      result.status = close < now ? 'closed' : 'open';
    } else {
      result.status = 'open';
    }
  }

  return result;
}

/**
 * Normalises a date string to ISO (YYYY-MM-DD).
 */
function normaliseDate(raw: string): string {
  const trimmed = raw.trim();

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const numericMatch = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (numericMatch) {
    return `${numericMatch[3]}-${numericMatch[2].padStart(2, '0')}-${numericMatch[1].padStart(2, '0')}`;
  }

  // DD Month YYYY
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().split('T')[0];
  }

  return trimmed;
}

/**
 * Extracts eligible organisation types from text.
 */
function extractEligibleTypes(text: string): string[] {
  const lower = text.toLowerCase();
  const types: string[] = [];
  const typeMap: Record<string, string> = {
    'community interest company': 'CIC',
    'cic': 'CIC',
    'charity': 'charity',
    'registered charity': 'charity',
    'social enterprise': 'social_enterprise',
    'voluntary organisation': 'voluntary',
    'voluntary group': 'voluntary',
    'community group': 'community_group',
    'not-for-profit': 'not_for_profit',
    'not for profit': 'not_for_profit',
    'nfp': 'not_for_profit',
    'cooperative': 'cooperative',
    'co-operative': 'cooperative',
    'local authority': 'local_authority',
    'parish council': 'parish_council',
    'town council': 'town_council',
    'school': 'school',
    'university': 'university',
    'housing association': 'housing_association',
    'community benefit society': 'community_benefit_society',
    'cbs': 'community_benefit_society',
    'unincorporated': 'unincorporated',
    'constituted group': 'constituted_group',
    'company limited by guarantee': 'clg',
    'clg': 'clg',
  };

  for (const [keyword, typeCode] of Object.entries(typeMap)) {
    if (lower.includes(keyword) && !types.includes(typeCode)) {
      types.push(typeCode);
    }
  }

  return types;
}

/**
 * Extracts UK geographic regions from text.
 */
function extractGeography(text: string): string | undefined {
  const lower = text.toLowerCase();
  const regions = [
    'England', 'Scotland', 'Wales', 'Northern Ireland',
    'UK-wide', 'nationwide', 'national',
    'North East', 'North West', 'Yorkshire', 'East Midlands', 'West Midlands',
    'East of England', 'London', 'South East', 'South West',
    'Greater Manchester', 'Merseyside', 'Lancashire', 'Cumbria',
    'Tyne and Wear', 'Kent', 'Surrey', 'Essex', 'Sussex',
    'Birmingham', 'Liverpool', 'Leeds', 'Sheffield', 'Bristol',
    'Manchester', 'Nottingham', 'Leicester', 'Coventry',
    'Oldham', 'Tameside', 'Stockport', 'Rochdale',
    'Bromley', 'Kingston', 'Belfast',
  ];

  const found: string[] = [];
  for (const region of regions) {
    if (lower.includes(region.toLowerCase())) {
      found.push(region);
    }
  }

  return found.length > 0 ? found.join(', ') : undefined;
}

/**
 * Extracts sector/focus-area keywords from text.
 */
function extractSectors(text: string): string[] {
  const sectorKeywords = [
    'health', 'education', 'youth', 'arts', 'culture', 'environment', 'climate',
    'housing', 'homelessness', 'mental health', 'disability', 'sport', 'community',
    'employment', 'skills', 'training', 'digital', 'rural', 'urban', 'poverty',
    'food', 'wellbeing', 'children', 'elderly', 'veterans', 'refugees',
    'social enterprise', 'social care', 'criminal justice', 'heritage',
    'transport', 'energy', 'biodiversity', 'conservation', 'infrastructure',
    'domestic abuse', 'violence', 'addiction', 'substance misuse',
    'loneliness', 'isolation', 'inclusion', 'equality', 'diversity',
  ];
  const lower = text.toLowerCase();
  return sectorKeywords.filter((kw) => lower.includes(kw));
}

/**
 * Extracts award/applicant statistics from text.
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

  const avgMatch = text.match(/(?:average|typical)\s+(?:award|grant)\s*(?:of|:)?\s*£?([\d,]+)/i);
  if (avgMatch) {
    result.averageAward = `£${avgMatch[1]}`;
  }

  return result;
}

/**
 * Checks whether text looks like grant content (vs navigation/UI junk).
 */
function isGrantContent(text: string): boolean {
  if (!text || text.length < 20) return false;
  if (JUNK_PATTERNS.test(text)) return false;
  // Must contain at least one grant-relevant word
  const lower = text.toLowerCase();
  const grantWords = ['grant', 'fund', 'funding', 'award', 'programme', 'scheme', 'bursary', 'investment', 'lottery', 'donation', 'charitable', 'application', 'apply', '£'];
  return grantWords.some((w) => lower.includes(w));
}

const JUNK_PATTERNS = /^(menu|home|skip|cookie|privacy|footer|header|search|filter|sort|page\s?\d|next|prev|about us|contact|sign\s|log\s|back|close|share|comment|subscribe|newsletter|loading|read more|learn more|view all|see all|show more|our guide|data quality|titles & descriptions|grant programme titles|accessibility|terms|sitemap|breadcrumb|navigation|copyright|follow us|social media|twitter|facebook|linkedin|instagram)/i;

/**
 * Extracts eligibility description from text.
 */
function extractEligibility(text: string): string | undefined {
  const patterns = [
    /(?:eligib(?:le|ility)|who can apply|open to|available to|aimed at|for)[:\s]*([^\n.]{10,250})/i,
    /(?:applicants?\s+must\s+be|you\s+must\s+be|organisations?\s+that)[:\s]*([^\n.]{10,250})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
}

/**
 * Extracts a funder name from a grant title.
 */
function extractFunderFromTitle(title: string): string {
  const separators = /\s*[|\-–—:]\s*/;
  const parts = title.split(separators);
  if (parts.length > 1) {
    return parts[0].trim();
  }
  return title.trim().slice(0, 60);
}

// ============================================================================
// Timeout wrapper
// ============================================================================

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[${label}] timed out after ${ms}ms`)), ms);
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

// ============================================================================
// Generic page scraper: fetches + parses text into grant blocks
// ============================================================================

async function fetchAndParse(url: string, useApify: boolean = false): Promise<{ html: string; text: string }> {
  if (useApify && isApifyAvailable()) {
    try {
      const result = await scrapeUrl(url);
      return { html: '', text: result.text };
    } catch {
      // Apify failed (memory limit, timeout, etc) — fall back to basic fetch
      console.warn(`[GrantScraper] Apify fallback for ${url}`);
    }
  }
  const html = await fetchPage(url);
  const text = await extractText(html);
  return { html, text };
}

/**
 * Generic section-based parser: splits text into double-newline sections and
 * extracts grant info from each section that looks like grant content.
 */
function parseTextSections(
  text: string,
  source: string,
  baseUrl: string,
  defaultFunder: string,
  now: string,
  maxGrants: number = 30,
): GrantOpportunity[] {
  const grants: GrantOpportunity[] = [];
  const sections = text.split(/\n\n+/);

  for (const section of sections) {
    if (section.length < 30) continue;
    if (grants.length >= maxGrants) break;

    const titleMatch = section.match(/^([A-Z][^\n]{8,120})/);
    if (!titleMatch) continue;

    const title = titleMatch[1].trim();
    if (JUNK_PATTERNS.test(title)) continue;
    if (title.length < 15) continue;

    // Require at least some grant-related content
    if (!isGrantContent(section)) continue;

    const amounts = extractAmounts(section);
    const dates = extractDates(section);
    const deadlineMatch = section.match(/(?:deadline|closes?|closing date)[:\s]*([^\n.]{5,60})/i);
    const stats = extractStats(section);
    const sectors = extractSectors(section);
    const eligibleTypes = extractEligibleTypes(section);
    const geography = extractGeography(section);
    const eligibility = extractEligibility(section);

    grants.push({
      title,
      funder: defaultFunder,
      url: baseUrl,
      amount: amounts.raw,
      amountMin: amounts.min,
      amountMax: amounts.max,
      openDate: dates.openDate,
      closeDate: dates.closeDate ?? (deadlineMatch ? deadlineMatch[1].trim() : undefined),
      deadline: deadlineMatch ? deadlineMatch[1].trim() : dates.closeDate,
      status: dates.status ?? 'open',
      eligibility,
      eligibleTypes: eligibleTypes.length > 0 ? eligibleTypes : undefined,
      description: section.slice(0, 400).trim(),
      sectors: sectors.length > 0 ? sectors : undefined,
      geography,
      previousAwards: stats.previousAwards,
      totalApplicants: stats.totalApplicants,
      averageAward: stats.averageAward,
      source,
      scrapedAt: now,
    });
  }

  return grants;
}

/**
 * Parse HTML for linked grant entries (anchors with titles).
 * Used as a fallback or primary method for sources that list grants as links.
 */
function parseLinkedEntries(
  html: string,
  text: string,
  source: string,
  baseUrl: string,
  defaultFunder: string,
  now: string,
  linkPattern: RegExp,
  maxGrants: number = 30,
): GrantOpportunity[] {
  const grants: GrantOpportunity[] = [];
  const matches = html.matchAll(linkPattern);

  for (const match of matches) {
    if (grants.length >= maxGrants) break;

    const rawUrl = match[1] ?? '';
    const rawTitle = (match[2] ?? '').replace(/<[^>]+>/g, '').trim();

    if (!rawTitle || rawTitle.length < 15) continue;
    if (JUNK_PATTERNS.test(rawTitle)) continue;
    // Filter out generic site navigation and service pages
    if (/^(help|support|training|events|networks|groups|resources|representation|digital|online|about|contact|volunteer|donate|news|blog|home|register|login|sign up|our work|what we do|get involved|join|membership|faqs?|policies|governance|annual report|accounts|team|staff|board|trustees|partners|jobs|careers|vacancies)/i.test(rawTitle)) continue;
    if (rawTitle.split(/\s+/).length < 3) continue; // Must be at least 3 words

    const fullUrl = rawUrl.startsWith('http') ? rawUrl : new URL(rawUrl, baseUrl).toString();

    // Find surrounding text for this grant in the full text
    const titleEscaped = rawTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60);
    const contextMatch = text.match(new RegExp(`${titleEscaped}[\\s\\S]{0,500}`, 'i'));
    const context = contextMatch ? contextMatch[0] : rawTitle;

    const amounts = extractAmounts(context);
    const dates = extractDates(context);
    const deadlineMatch = context.match(/(?:deadline|closes?|closing date)[:\s]*([^\n.]{5,60})/i);
    const sectors = extractSectors(context);
    const eligibleTypes = extractEligibleTypes(context);
    const geography = extractGeography(context);

    grants.push({
      title: rawTitle,
      funder: defaultFunder,
      url: fullUrl,
      amount: amounts.raw,
      amountMin: amounts.min,
      amountMax: amounts.max,
      openDate: dates.openDate,
      closeDate: dates.closeDate ?? (deadlineMatch ? deadlineMatch[1].trim() : undefined),
      deadline: deadlineMatch ? deadlineMatch[1].trim() : dates.closeDate,
      status: dates.status,
      eligibility: extractEligibility(context),
      eligibleTypes: eligibleTypes.length > 0 ? eligibleTypes : undefined,
      description: context.slice(0, 400).trim(),
      sectors: sectors.length > 0 ? sectors : undefined,
      geography,
      source,
      scrapedAt: now,
    });
  }

  return grants;
}

// ============================================================================
// Individual source scrapers (15+ sources)
// ============================================================================

// 1. Action Together
async function scrapeActionTogether(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://www.actiontogether.org.uk/find-funding';
  const { html, text } = await fetchAndParse(url, true);

  const grants: GrantOpportunity[] = [];

  // Try parsing structured grant cards from HTML
  const cardBlocks = html.match(/<(?:div|article|li)[^>]*class="[^"]*(?:card|listing|fund|grant|opportunity)[^"]*"[^>]*>[\s\S]*?<\/(?:div|article|li)>/gi) ?? [];

  for (const block of cardBlocks.slice(0, 30)) {
    const titleMatch = block.match(/<h[2-5][^>]*>(?:<a[^>]*>)?([^<]{10,120})/i);
    if (!titleMatch) continue;

    const title = titleMatch[1].trim();
    if (JUNK_PATTERNS.test(title)) continue;

    const blockText = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const amounts = extractAmounts(blockText);
    const dates = extractDates(blockText);
    const eligibleTypes = extractEligibleTypes(blockText);
    const urlMatch = block.match(/href="([^"]*fund[^"]*)"/i) ?? block.match(/href="([^"]+)"/i);

    grants.push({
      title,
      funder: extractFunderFromTitle(title),
      url: urlMatch ? new URL(urlMatch[1], url).toString() : url,
      amount: amounts.raw,
      amountMin: amounts.min,
      amountMax: amounts.max,
      openDate: dates.openDate,
      closeDate: dates.closeDate,
      deadline: dates.closeDate,
      status: dates.status,
      eligibility: extractEligibility(blockText),
      eligibleTypes: eligibleTypes.length > 0 ? eligibleTypes : undefined,
      description: blockText.slice(0, 400).trim(),
      sectors: extractSectors(blockText),
      geography: extractGeography(blockText) ?? 'Greater Manchester',
      source: 'action_together',
      scrapedAt: now,
    });
  }

  // Fallback to text parsing if no cards found
  if (grants.length === 0) {
    grants.push(...parseTextSections(text, 'action_together', url, 'Action Together', now));
  }

  return grants;
}

// 2. GrantMatch (two pages: social enterprise + CIC)
async function scrapeGrantMatch(now: string): Promise<GrantOpportunity[]> {
  const urls = [
    'https://www.grantmatch.co.uk/grants/org-type/social-enterprise',
    'https://www.grantmatch.co.uk/grants/org-type/community-interest-company',
  ];

  const grants: GrantOpportunity[] = [];

  for (const pageUrl of urls) {
    try {
      const { html, text } = await fetchAndParse(pageUrl, true);

      // Try structured card parsing
      const cardBlocks = html.match(/<(?:div|article|li)[^>]*class="[^"]*(?:grant|listing|card|result)[^"]*"[^>]*>[\s\S]*?<\/(?:div|article|li)>/gi) ?? [];

      for (const block of cardBlocks.slice(0, 25)) {
        const titleMatch = block.match(/<h[2-5][^>]*>(?:<a[^>]*>)?([^<]{10,120})/i);
        if (!titleMatch) continue;

        const title = titleMatch[1].trim();
        if (JUNK_PATTERNS.test(title)) continue;

        const blockText = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const amounts = extractAmounts(blockText);
        const dates = extractDates(blockText);
        const eligibleTypes = extractEligibleTypes(blockText);
        const urlMatch = block.match(/href="([^"]*grant[^"]*)"/i) ?? block.match(/href="([^"]+)"/i);
        const orgType = pageUrl.includes('social-enterprise') ? 'social_enterprise' : 'CIC';

        grants.push({
          title,
          funder: extractFunderFromTitle(title),
          url: urlMatch ? new URL(urlMatch[1], pageUrl).toString() : pageUrl,
          amount: amounts.raw,
          amountMin: amounts.min,
          amountMax: amounts.max,
          openDate: dates.openDate,
          closeDate: dates.closeDate,
          deadline: dates.closeDate,
          status: dates.status,
          eligibility: extractEligibility(blockText),
          eligibleTypes: eligibleTypes.length > 0 ? eligibleTypes : [orgType],
          description: blockText.slice(0, 400).trim(),
          sectors: extractSectors(blockText),
          geography: extractGeography(blockText),
          source: 'grantmatch',
          scrapedAt: now,
        });
      }

      // Fallback to text sections
      if (cardBlocks.length === 0) {
        grants.push(...parseTextSections(text, 'grantmatch', pageUrl, 'GrantMatch', now));
      }
    } catch (err) {
      console.error(`[GrantScraper] GrantMatch page ${pageUrl} failed:`, err instanceof Error ? err.message : err);
    }
  }

  return grants;
}

// 3. Kingston Voluntary Action
async function scrapeKingstonVoluntaryAction(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://kva.org.uk/funding/grants-available-with-deadline/';
  const { html, text } = await fetchAndParse(url);

  // Try link-based parsing first
  const linkGrants = parseLinkedEntries(
    html, text, 'kingston_voluntary_action', url, 'Kingston Voluntary Action',
    now, /<a[^>]*href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/gi, 30
  );

  if (linkGrants.length > 0) {
    // Set default geography
    return linkGrants.map((g) => ({ ...g, geography: g.geography ?? 'Kingston upon Thames, London' }));
  }

  return parseTextSections(text, 'kingston_voluntary_action', url, 'Kingston Voluntary Action', now)
    .map((g) => ({ ...g, geography: g.geography ?? 'Kingston upon Thames, London' }));
}

// 4. National Lottery Community Fund
async function scrapeNationalLottery(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://www.tnlcommunityfund.org.uk/funding/programmes';
  const { html, text } = await fetchAndParse(url, true);

  const grants: GrantOpportunity[] = [];

  // Parse programme cards
  const cardBlocks = html.match(/<(?:div|article|li)[^>]*class="[^"]*(?:programme|card|listing|result)[^"]*"[^>]*>[\s\S]*?<\/(?:div|article|li)>/gi) ?? [];

  for (const block of cardBlocks.slice(0, 30)) {
    const titleMatch = block.match(/<h[2-5][^>]*>(?:<a[^>]*>)?([^<]{10,120})/i);
    if (!titleMatch) continue;

    const title = titleMatch[1].trim();
    if (JUNK_PATTERNS.test(title)) continue;

    const blockText = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const amounts = extractAmounts(blockText);
    const dates = extractDates(blockText);
    const urlMatch = block.match(/href="([^"]*programme[^"]*)"/i) ?? block.match(/href="([^"]*funding[^"]*)"/i) ?? block.match(/href="([^"]+)"/i);

    grants.push({
      title,
      funder: 'The National Lottery Community Fund',
      url: urlMatch ? new URL(urlMatch[1], url).toString() : url,
      amount: amounts.raw,
      amountMin: amounts.min,
      amountMax: amounts.max,
      openDate: dates.openDate,
      closeDate: dates.closeDate,
      deadline: dates.closeDate,
      status: dates.status ?? 'open',
      eligibility: extractEligibility(blockText),
      eligibleTypes: extractEligibleTypes(blockText),
      description: blockText.slice(0, 400).trim(),
      sectors: extractSectors(blockText),
      geography: extractGeography(blockText) ?? 'UK-wide',
      source: 'tnl_community_fund',
      scrapedAt: now,
      ...extractStats(blockText),
    });
  }

  // Fallback text parsing
  if (grants.length === 0) {
    grants.push(...parseTextSections(text, 'tnl_community_fund', url, 'The National Lottery Community Fund', now));
  }

  return grants;
}

// 5. 360Giving GrantNav
async function scrapeGrantNav(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://grantnav.threesixtygiving.org/search?query=community+funding+UK';
  const { html, text } = await fetchAndParse(url);

  const grants: GrantOpportunity[] = [];

  // GrantNav grant-result blocks
  const grantBlocks = html.match(/<div class="grant-result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) ?? [];

  if (grantBlocks.length > 0) {
    for (const block of grantBlocks.slice(0, 25)) {
      const titleMatch = block.match(/<h3[^>]*>([^<]+)<\/h3>/i) ?? block.match(/<a[^>]*>([^<]{10,})<\/a>/i);
      if (!titleMatch) continue;

      const blockText = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const amounts = extractAmounts(blockText);
      const dates = extractDates(blockText);
      const funderMatch = blockText.match(/(?:funder|funded by|from)[:\s]*([^<\n]{5,80})/i);
      const urlMatch = block.match(/href="([^"]*grant[^"]*)"/i);

      grants.push({
        title: titleMatch[1].trim(),
        funder: funderMatch ? funderMatch[1].trim() : 'Unknown',
        url: urlMatch ? `https://grantnav.threesixtygiving.org${urlMatch[1]}` : url,
        amount: amounts.raw,
        amountMin: amounts.min,
        amountMax: amounts.max,
        openDate: dates.openDate,
        closeDate: dates.closeDate,
        deadline: dates.closeDate,
        status: dates.status,
        eligibility: extractEligibility(blockText),
        eligibleTypes: extractEligibleTypes(blockText),
        description: blockText.slice(0, 400).trim(),
        sectors: extractSectors(blockText),
        geography: extractGeography(blockText),
        source: '360giving_grantnav',
        scrapedAt: now,
        ...extractStats(blockText),
      });
    }
  }

  // Fallback: parse grant links
  if (grants.length === 0) {
    const linkGrants = parseLinkedEntries(
      html, text, '360giving_grantnav', url, 'Unknown',
      now, /<a[^>]*href="(\/grant\/[^"]+)"[^>]*>([^<]{10,100})<\/a>/gi, 25
    );
    grants.push(...linkGrants);
  }

  return grants;
}

// 6. GOV.UK Business Finance Support
async function scrapeGovUk(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://www.gov.uk/business-finance-support';
  const { html, text } = await fetchAndParse(url);

  const grants: GrantOpportunity[] = [];

  // GOV.UK uses gem-c-document-list items
  const listItems = html.match(/<li[^>]*class="[^"]*document[^"]*"[^>]*>[\s\S]*?<\/li>/gi)
    ?? html.match(/<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>/gi)
    ?? [];

  for (const block of listItems.slice(0, 30)) {
    const titleMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/i);
    if (!titleMatch) continue;

    const title = titleMatch[2].trim();
    if (JUNK_PATTERNS.test(title)) continue;

    const blockText = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const amounts = extractAmounts(blockText);
    const dates = extractDates(blockText);
    const eligibleTypes = extractEligibleTypes(blockText);

    grants.push({
      title,
      funder: 'UK Government',
      url: titleMatch[1].startsWith('http') ? titleMatch[1] : `https://www.gov.uk${titleMatch[1]}`,
      amount: amounts.raw,
      amountMin: amounts.min,
      amountMax: amounts.max,
      openDate: dates.openDate,
      closeDate: dates.closeDate,
      deadline: dates.closeDate,
      status: dates.status ?? 'open',
      eligibility: extractEligibility(blockText),
      eligibleTypes: eligibleTypes.length > 0 ? eligibleTypes : undefined,
      description: blockText.slice(0, 400).trim(),
      sectors: extractSectors(blockText),
      geography: extractGeography(blockText) ?? 'UK-wide',
      source: 'gov_uk',
      scrapedAt: now,
    });
  }

  // Fallback text parsing
  if (grants.length === 0) {
    grants.push(...parseTextSections(text, 'gov_uk', url, 'UK Government', now));
  }

  return grants;
}

// 7. Charity Excellence Framework
async function scrapeCharityExcellence(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://www.charityexcellence.co.uk/core-costs-funding-for-charities/';
  const { html, text } = await fetchAndParse(url);

  // Try table parsing first — Charity Excellence often has tables
  const tableRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const grants: GrantOpportunity[] = [];

  for (const row of tableRows.slice(1, 40)) { // skip header row
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) ?? [];
    if (cells.length < 2) continue;

    const cellTexts = cells.map((c) => c.replace(/<[^>]+>/g, '').trim());
    const titleCell = cellTexts[0];
    if (!titleCell || titleCell.length < 5) continue;
    if (JUNK_PATTERNS.test(titleCell)) continue;

    const rowText = cellTexts.join(' ');
    const amounts = extractAmounts(rowText);
    const dates = extractDates(rowText);
    const urlMatch = row.match(/href="([^"]+)"/i);

    grants.push({
      title: titleCell,
      funder: extractFunderFromTitle(titleCell),
      url: urlMatch ? urlMatch[1] : url,
      amount: amounts.raw,
      amountMin: amounts.min,
      amountMax: amounts.max,
      openDate: dates.openDate,
      closeDate: dates.closeDate,
      deadline: dates.closeDate,
      status: dates.status,
      eligibility: extractEligibility(rowText),
      eligibleTypes: extractEligibleTypes(rowText),
      description: rowText.slice(0, 400).trim(),
      sectors: extractSectors(rowText),
      geography: extractGeography(rowText),
      source: 'charity_excellence',
      scrapedAt: now,
    });
  }

  // Fallback to text sections
  if (grants.length === 0) {
    grants.push(...parseTextSections(text, 'charity_excellence', url, 'Charity Excellence', now));
  }

  return grants;
}

// 8. Manchester Community Central
async function scrapeManchesterCommunityCentral(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://manchestercommunitycentral.org/funding-opportunities';
  const { html, text } = await fetchAndParse(url, true);

  const linkGrants = parseLinkedEntries(
    html, text, 'manchester_community_central', url, 'Manchester Community Central',
    now, /<a[^>]*href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/gi, 30
  );

  if (linkGrants.length > 0) {
    return linkGrants
      .filter((g) => isGrantContent(g.title + ' ' + (g.description ?? '')))
      .map((g) => ({ ...g, geography: g.geography ?? 'Greater Manchester' }));
  }

  return parseTextSections(text, 'manchester_community_central', url, 'Manchester Community Central', now)
    .map((g) => ({ ...g, geography: g.geography ?? 'Greater Manchester' }));
}

// 9. Community Works
async function scrapeCommunityWorks(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://www.communityworks.org.uk/help-guidance/funding-and-income/';
  const { html, text } = await fetchAndParse(url);

  const linkGrants = parseLinkedEntries(
    html, text, 'community_works', url, 'Community Works',
    now, /<a[^>]*href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/gi, 30
  );

  if (linkGrants.length > 0) {
    return linkGrants
      .filter((g) => isGrantContent(g.title + ' ' + (g.description ?? '')))
      .map((g) => ({ ...g, geography: g.geography ?? 'Brighton & Hove, East Sussex' }));
  }

  return parseTextSections(text, 'community_works', url, 'Community Works', now)
    .map((g) => ({ ...g, geography: g.geography ?? 'Brighton & Hove, East Sussex' }));
}

// 10. In Kind Direct - Signposts to Funding
async function scrapeInKindDirect(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://www.inkinddirect.org/community-news/signposts-to-funding';
  const { html, text } = await fetchAndParse(url);

  const linkGrants = parseLinkedEntries(
    html, text, 'inkind_direct', url, 'In Kind Direct',
    now, /<a[^>]*href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/gi, 30
  );

  if (linkGrants.length > 0) {
    return linkGrants.filter((g) => isGrantContent(g.title + ' ' + (g.description ?? '')));
  }

  return parseTextSections(text, 'inkind_direct', url, 'In Kind Direct', now);
}

// 11. Community Links Bromley
async function scrapeCommunityLinksBromley(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://www.communitylinksbromley.org.uk/support-services/help-with-funding/latest-funding-opportunities/';
  const { html, text } = await fetchAndParse(url);

  const linkGrants = parseLinkedEntries(
    html, text, 'community_links_bromley', url, 'Community Links Bromley',
    now, /<a[^>]*href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/gi, 30
  );

  if (linkGrants.length > 0) {
    return linkGrants
      .filter((g) => isGrantContent(g.title + ' ' + (g.description ?? '')))
      .map((g) => ({ ...g, geography: g.geography ?? 'Bromley, London' }));
  }

  return parseTextSections(text, 'community_links_bromley', url, 'Community Links Bromley', now)
    .map((g) => ({ ...g, geography: g.geography ?? 'Bromley, London' }));
}

// 12. Rural Services Network
async function scrapeRuralServicesNetwork(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://rsnonline.org.uk/rural-funding-digest-april-2026';
  const { html, text } = await fetchAndParse(url);

  // RSN digest is article-style — parse text sections
  const grants = parseTextSections(text, 'rural_services_network', url, 'Rural Services Network', now);

  // If main URL fails (date-specific), try the generic digest page
  if (grants.length === 0) {
    try {
      const fallbackUrl = 'https://rsnonline.org.uk/category/rural-funding-digest';
      const { html: fbHtml, text: fbText } = await fetchAndParse(fallbackUrl);
      const linkGrants = parseLinkedEntries(
        fbHtml, fbText, 'rural_services_network', fallbackUrl, 'Rural Services Network',
        now, /<a[^>]*href="([^"]*funding[^"]*)"[^>]*>([^<]{10,120})<\/a>/gi, 30
      );
      grants.push(...linkGrants.filter((g) => isGrantContent(g.title + ' ' + (g.description ?? ''))));
    } catch {
      // silent fallback failure
    }
  }

  return grants.map((g) => ({ ...g, geography: g.geography ?? 'Rural England' }));
}

// 13. CF Merseyside
async function scrapeCFMerseyside(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://cfmerseyside.org.uk/our-grants';
  const { html, text } = await fetchAndParse(url, true);

  const grants: GrantOpportunity[] = [];

  // Try card-based parsing
  const cardBlocks = html.match(/<(?:div|article|li|section)[^>]*class="[^"]*(?:grant|fund|card|programme)[^"]*"[^>]*>[\s\S]*?<\/(?:div|article|li|section)>/gi) ?? [];

  for (const block of cardBlocks.slice(0, 25)) {
    const titleMatch = block.match(/<h[2-5][^>]*>(?:<a[^>]*>)?([^<]{10,120})/i);
    if (!titleMatch) continue;

    const title = titleMatch[1].trim();
    if (JUNK_PATTERNS.test(title)) continue;

    const blockText = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const amounts = extractAmounts(blockText);
    const dates = extractDates(blockText);
    const urlMatch = block.match(/href="([^"]+)"/i);

    grants.push({
      title,
      funder: 'Community Foundation for Merseyside',
      url: urlMatch ? new URL(urlMatch[1], url).toString() : url,
      amount: amounts.raw,
      amountMin: amounts.min,
      amountMax: amounts.max,
      openDate: dates.openDate,
      closeDate: dates.closeDate,
      deadline: dates.closeDate,
      status: dates.status,
      eligibility: extractEligibility(blockText),
      eligibleTypes: extractEligibleTypes(blockText),
      description: blockText.slice(0, 400).trim(),
      sectors: extractSectors(blockText),
      geography: 'Merseyside',
      source: 'cf_merseyside',
      scrapedAt: now,
    });
  }

  // Fallback
  if (grants.length === 0) {
    grants.push(...parseTextSections(text, 'cf_merseyside', url, 'Community Foundation for Merseyside', now)
      .map((g) => ({ ...g, geography: 'Merseyside' })));
  }

  return grants;
}

// 14. Supporting Communities NI
async function scrapeSupportingCommunitiesNI(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://supportingcommunities.org/funding-news-1';
  const { html, text } = await fetchAndParse(url);

  const linkGrants = parseLinkedEntries(
    html, text, 'supporting_communities_ni', url, 'Supporting Communities NI',
    now, /<a[^>]*href="([^"]+)"[^>]*>([^<]{10,120})<\/a>/gi, 30
  );

  if (linkGrants.length > 0) {
    return linkGrants
      .filter((g) => isGrantContent(g.title + ' ' + (g.description ?? '')))
      .map((g) => ({ ...g, geography: g.geography ?? 'Northern Ireland' }));
  }

  return parseTextSections(text, 'supporting_communities_ni', url, 'Supporting Communities NI', now)
    .map((g) => ({ ...g, geography: g.geography ?? 'Northern Ireland' }));
}

// 15. Google Search (via Apify) / DuckDuckGo fallback — 5 targeted queries
async function scrapeGoogleSearch(now: string): Promise<GrantOpportunity[]> {
  const queries = [
    '"grants open" 2026 UK CIC "social enterprise" deadline amount',
    '"grant funding" "now open" UK community interest company',
    'UK grants April May June 2026 CIC social enterprise deadline',
    'National Lottery Heritage Fund open 2026',
    '"grants for" CIC OR "social enterprise" OR charity UK 2026 open apply',
  ];

  const grants: GrantOpportunity[] = [];
  const useApify = isApifyAvailable();

  for (const query of queries) {
    try {
      let results: Array<{ title: string; url: string; snippet: string }>;
      if (useApify) {
        try {
          results = await searchGoogle(query, 10);
        } catch {
          // Apify failed — fall back to DuckDuckGo
          results = await searchWeb(query);
        }
      } else {
        results = await searchWeb(query);
      }

      for (const result of results.slice(0, 10)) {
        const snippet = result.snippet ?? '';
        const combined = result.title + ' ' + snippet;

        if (!isGrantContent(combined)) continue;

        const amounts = extractAmounts(combined);
        const dates = extractDates(combined);
        const eligibleTypes = extractEligibleTypes(combined);
        const sectors = extractSectors(combined);
        const geography = extractGeography(combined);

        grants.push({
          title: result.title,
          funder: extractFunderFromTitle(result.title),
          url: result.url,
          amount: amounts.raw,
          amountMin: amounts.min,
          amountMax: amounts.max,
          openDate: dates.openDate,
          closeDate: dates.closeDate,
          deadline: dates.closeDate,
          status: dates.status ?? 'open',
          eligibility: extractEligibility(combined),
          eligibleTypes: eligibleTypes.length > 0 ? eligibleTypes : undefined,
          description: snippet.slice(0, 400).trim(),
          sectors: sectors.length > 0 ? sectors : undefined,
          geography,
          source: useApify ? 'google_search' : 'duckduckgo_search',
          scrapedAt: now,
        });
      }
    } catch (err) {
      console.error(`[GrantScraper] Search query failed ("${query.slice(0, 40)}..."):`, err instanceof Error ? err.message : err);
    }
  }

  return grants;
}

// 16. fundsforNGOs
async function scrapeFundsForNGOs(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://www2.fundsforngos.org/tag/united-kingdom/';
  const { html, text } = await fetchAndParse(url);

  // fundsforNGOs is blog-style with post titles as links
  const linkGrants = parseLinkedEntries(
    html, text, 'fundsforngos', url, 'fundsforNGOs',
    now, /<h[2-4][^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]{10,150})<\/a>/gi, 30
  );

  if (linkGrants.length > 0) {
    return linkGrants
      .filter((g) => isGrantContent(g.title + ' ' + (g.description ?? '')))
      .map((g) => ({ ...g, geography: g.geography ?? 'UK-wide' }));
  }

  // Broader link fallback
  const broadLinks = parseLinkedEntries(
    html, text, 'fundsforngos', url, 'fundsforNGOs',
    now, /<a[^>]*href="(https?:\/\/www2\.fundsforngos\.org\/[^"]+)"[^>]*>([^<]{10,150})<\/a>/gi, 30
  );

  return broadLinks
    .filter((g) => isGrantContent(g.title + ' ' + (g.description ?? '')))
    .map((g) => ({ ...g, geography: g.geography ?? 'UK-wide' }));
}

// 17. Grants Online
async function scrapeGrantsOnline(now: string): Promise<GrantOpportunity[]> {
  const url = 'https://www.grantsonline.org.uk/news/community-development/';
  const { html, text } = await fetchAndParse(url);

  // Grants Online uses article/post listing format
  const linkGrants = parseLinkedEntries(
    html, text, 'grants_online', url, 'Grants Online',
    now, /<a[^>]*href="([^"]+)"[^>]*>([^<]{10,150})<\/a>/gi, 30
  );

  if (linkGrants.length > 0) {
    return linkGrants
      .filter((g) => isGrantContent(g.title + ' ' + (g.description ?? '')))
      .map((g) => ({ ...g, geography: g.geography ?? 'UK-wide' }));
  }

  return parseTextSections(text, 'grants_online', url, 'Grants Online', now)
    .map((g) => ({ ...g, geography: g.geography ?? 'UK-wide' }));
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Normalises a title for dedup comparison: lowercase, strip punctuation,
 * collapse whitespace.
 */
function normaliseTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Simple similarity check: returns true if two normalised titles share
 * >70% of their words (Jaccard similarity).
 */
function titlesSimilar(a: string, b: string): boolean {
  const wordsA = new Set(a.split(' ').filter((w) => w.length > 2));
  const wordsB = new Set(b.split(' ').filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return overlap / union > 0.7;
}

function deduplicateOpportunities(opportunities: GrantOpportunity[]): GrantOpportunity[] {
  const kept: GrantOpportunity[] = [];
  const normTitles: string[] = [];

  for (const opp of opportunities) {
    // Filter junk
    if (JUNK_PATTERNS.test(opp.title)) continue;
    if (opp.title.length < 15) continue;
    if (
      opp.funder === 'Unknown' &&
      !opp.amount &&
      !opp.deadline &&
      (!opp.description || opp.description.length < 50)
    ) continue;

    const norm = normaliseTitleForDedup(opp.title);

    // Check exact duplicate
    if (normTitles.includes(norm)) continue;

    // Check fuzzy duplicate
    const isDupe = normTitles.some((existing) => titlesSimilar(norm, existing));
    if (isDupe) continue;

    normTitles.push(norm);
    kept.push(opp);
  }

  return kept;
}

// ============================================================================
// Exported functions
// ============================================================================

/**
 * Scrapes all 17+ configured UK grant portals in parallel and returns
 * combined, deduplicated results.
 *
 * Each source has a 30-second timeout. Total scrape targets < 2 minutes.
 * Individual source failures do not affect other sources.
 */
export async function scrapeGrantPortals(): Promise<GrantOpportunity[]> {
  const now = new Date().toISOString();
  const TIMEOUT = 30_000;

  console.log(`[GrantScraper] Starting comprehensive scrape of ${SCRAPE_SOURCES.length} sources...`);
  const startTime = Date.now();

  // Launch all scrapers in parallel with individual timeouts
  const scraperTasks: Array<Promise<SourceResult>> = [
    withTimeout(scrapeActionTogether(now), TIMEOUT, 'action_together')
      .then((grants) => ({ source: 'action_together', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'action_together', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeGrantMatch(now), TIMEOUT, 'grantmatch')
      .then((grants) => ({ source: 'grantmatch', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'grantmatch', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeKingstonVoluntaryAction(now), TIMEOUT, 'kingston_voluntary_action')
      .then((grants) => ({ source: 'kingston_voluntary_action', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'kingston_voluntary_action', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeNationalLottery(now), TIMEOUT, 'tnl_community_fund')
      .then((grants) => ({ source: 'tnl_community_fund', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'tnl_community_fund', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeGrantNav(now), TIMEOUT, '360giving_grantnav')
      .then((grants) => ({ source: '360giving_grantnav', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: '360giving_grantnav', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeGovUk(now), TIMEOUT, 'gov_uk')
      .then((grants) => ({ source: 'gov_uk', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'gov_uk', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeCharityExcellence(now), TIMEOUT, 'charity_excellence')
      .then((grants) => ({ source: 'charity_excellence', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'charity_excellence', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeManchesterCommunityCentral(now), TIMEOUT, 'manchester_community_central')
      .then((grants) => ({ source: 'manchester_community_central', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'manchester_community_central', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeCommunityWorks(now), TIMEOUT, 'community_works')
      .then((grants) => ({ source: 'community_works', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'community_works', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeInKindDirect(now), TIMEOUT, 'inkind_direct')
      .then((grants) => ({ source: 'inkind_direct', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'inkind_direct', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeCommunityLinksBromley(now), TIMEOUT, 'community_links_bromley')
      .then((grants) => ({ source: 'community_links_bromley', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'community_links_bromley', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeRuralServicesNetwork(now), TIMEOUT, 'rural_services_network')
      .then((grants) => ({ source: 'rural_services_network', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'rural_services_network', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeCFMerseyside(now), TIMEOUT, 'cf_merseyside')
      .then((grants) => ({ source: 'cf_merseyside', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'cf_merseyside', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeSupportingCommunitiesNI(now), TIMEOUT, 'supporting_communities_ni')
      .then((grants) => ({ source: 'supporting_communities_ni', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'supporting_communities_ni', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeGoogleSearch(now), TIMEOUT * 2, 'google_search') // double timeout for 5 queries
      .then((grants) => ({ source: 'google_search', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'google_search', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeFundsForNGOs(now), TIMEOUT, 'fundsforngos')
      .then((grants) => ({ source: 'fundsforngos', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'fundsforngos', grants: [], error: err.message, durationMs: Date.now() - startTime })),

    withTimeout(scrapeGrantsOnline(now), TIMEOUT, 'grants_online')
      .then((grants) => ({ source: 'grants_online', grants, durationMs: Date.now() - startTime }))
      .catch((err) => ({ source: 'grants_online', grants: [], error: err.message, durationMs: Date.now() - startTime })),
  ];

  const results = await Promise.all(scraperTasks);

  // Log results summary
  const allGrants: GrantOpportunity[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const result of results) {
    if (result.error) {
      failed++;
      console.error(`[GrantScraper] FAILED ${result.source} (${result.durationMs}ms): ${result.error}`);
    } else {
      succeeded++;
      console.log(`[GrantScraper] OK ${result.source}: ${result.grants.length} grants (${result.durationMs}ms)`);
    }
    allGrants.push(...result.grants);
  }

  const totalDuration = Date.now() - startTime;
  const deduplicated = deduplicateOpportunities(allGrants);

  console.log(`[GrantScraper] Complete: ${succeeded}/${results.length} sources succeeded, ${failed} failed`);
  console.log(`[GrantScraper] Raw grants: ${allGrants.length}, After dedup: ${deduplicated.length}, Duration: ${totalDuration}ms`);

  return deduplicated;
}

/**
 * Searches for grant opportunities matching a specific client profile.
 * Runs targeted searches across GrantNav, DuckDuckGo/Google, and GOV.UK.
 */
export async function searchGrantsForClient(
  clientType: string,
  geography: string,
  sector?: string,
): Promise<GrantOpportunity[]> {
  const now = new Date().toISOString();
  const TIMEOUT = 30_000;

  const typeTerms: Record<string, string> = {
    CIC: 'community interest company CIC',
    charity: 'charity registered charity',
    social_enterprise: 'social enterprise',
    unincorporated: 'community group unincorporated',
    cooperative: 'cooperative co-operative',
    voluntary: 'voluntary organisation voluntary group',
    clg: 'company limited by guarantee',
  };

  const typeQuery = typeTerms[clientType] ?? clientType;
  const sectorQuery = sector ? ` ${sector}` : '';

  const tasks: Array<Promise<GrantOpportunity[]>> = [];

  // 1. GrantNav targeted search
  tasks.push(
    withTimeout((async () => {
      const query = `${typeQuery} ${geography}${sectorQuery}`;
      const grantNavUrl = `https://grantnav.threesixtygiving.org/search?query=${encodeURIComponent(query)}`;
      const { html, text } = await fetchAndParse(grantNavUrl);

      const linkGrants = parseLinkedEntries(
        html, text, '360giving_grantnav', grantNavUrl, 'Unknown',
        now, /<a[^>]*href="(\/grant\/[^"]+)"[^>]*>([^<]{10,100})<\/a>/gi, 20
      );

      if (linkGrants.length > 0) return linkGrants;
      return parseTextSections(text, '360giving_grantnav', grantNavUrl, 'Unknown', now, 20);
    })(), TIMEOUT, 'grantnav_client')
      .catch(() => [] as GrantOpportunity[])
  );

  // 2. DuckDuckGo / Google targeted search
  tasks.push(
    withTimeout((async () => {
      const query = `"grant funding" "now open" UK ${typeQuery} ${geography}${sectorQuery} 2026`;
      const useApify = isApifyAvailable();
      const results = useApify ? await searchGoogle(query, 15) : await searchWeb(query);
      const grants: GrantOpportunity[] = [];

      for (const result of results.slice(0, 15)) {
        const combined = result.title + ' ' + (result.snippet ?? '');
        const amounts = extractAmounts(combined);
        const dates = extractDates(combined);

        grants.push({
          title: result.title,
          funder: extractFunderFromTitle(result.title),
          url: result.url,
          amount: amounts.raw,
          amountMin: amounts.min,
          amountMax: amounts.max,
          description: result.snippet,
          source: useApify ? 'google_search' : 'duckduckgo_search',
          scrapedAt: now,
          openDate: dates.openDate,
          closeDate: dates.closeDate,
          deadline: dates.closeDate,
          status: dates.status ?? 'open',
          eligibleTypes: extractEligibleTypes(combined),
          sectors: extractSectors(combined),
          geography: extractGeography(combined) ?? geography,
        });
      }
      return grants;
    })(), TIMEOUT, 'search_client')
      .catch(() => [] as GrantOpportunity[])
  );

  // 3. GOV.UK targeted search
  tasks.push(
    withTimeout((async () => {
      const govQuery = `${typeQuery} ${geography}${sectorQuery}`;
      const govUrl = `https://www.gov.uk/business-finance-support?q=${encodeURIComponent(govQuery)}`;
      const { html, text } = await fetchAndParse(govUrl);
      const grants = parseTextSections(text, 'gov_uk', govUrl, 'UK Government', now, 15);
      return grants;
    })(), TIMEOUT, 'govuk_client')
      .catch(() => [] as GrantOpportunity[])
  );

  // 4. Action Together (if Manchester area)
  if (/manchester|greater manchester|oldham|tameside|stockport|rochdale/i.test(geography)) {
    tasks.push(
      withTimeout(scrapeActionTogether(now), TIMEOUT, 'action_together_client')
        .catch(() => [] as GrantOpportunity[])
    );
  }

  // 5. Supporting Communities NI (if Northern Ireland)
  if (/northern ireland|belfast|ni\b/i.test(geography)) {
    tasks.push(
      withTimeout(scrapeSupportingCommunitiesNI(now), TIMEOUT, 'ni_client')
        .catch(() => [] as GrantOpportunity[])
    );
  }

  const results = await Promise.all(tasks);
  const allGrants = results.flat();

  return deduplicateOpportunities(allGrants);
}

/**
 * Returns the list of all configured scrape source names.
 */
export function getScrapeSources(): string[] {
  return [...SCRAPE_SOURCES];
}
