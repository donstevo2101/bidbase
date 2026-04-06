/**
 * Data enrichment orchestrator for BidBase.
 * Combines Companies House, web scraping, and grant databases
 * to build a comprehensive client profile.
 */

import {
  searchCompaniesHouse,
  getCompanyProfile,
  getCompanyOfficers,
  getCompanyFilingHistory,
} from './companiesHouse.js';
import { fetchPage, extractText, searchWeb } from '../lib/scraper.js';
import { searchGoogle, scrapeLinkedIn, isApifyAvailable } from '../lib/apify.js';

// ---- Types ----

export interface EnrichedClientData {
  // Companies House
  companyNumber?: string;
  companyName?: string;
  companyType?: string;
  companyStatus?: string;
  dateOfCreation?: string;
  registeredAddress?: Record<string, string>;
  sicCodes?: string[];
  officers?: Array<{ name: string; role: string; appointedOn: string }>;
  recentFilings?: Array<{ date: string; description: string }>;
  hasInsolvencyHistory?: boolean;

  // Web scraping
  linkedinUrl?: string;
  linkedinSummary?: string;
  websiteUrl?: string;
  charityNumber?: string;
  charityCommissionData?: string;

  // Grant history
  previousGrants?: Array<{ funder: string; amount?: string; date?: string; project?: string }>;

  // Public records summary
  publicRecordsSummary?: string;

  // Confidence and sources
  sources: string[];
  enrichedAt: string;
}

// ---- Main enrichment function ----

/**
 * Enriches a client record by combining Companies House data,
 * web scraping, and grant database searches.
 */
export async function enrichClientData(
  clientName: string,
  registeredNumber?: string
): Promise<EnrichedClientData> {
  const sources: string[] = [];
  const enriched: EnrichedClientData = {
    sources,
    enrichedAt: new Date().toISOString(),
  };

  // Step 1: Companies House data
  try {
    if (registeredNumber) {
      const profile = await getCompanyProfile(registeredNumber);
      if (profile.companyName) {
        applyCompanyProfile(enriched, profile);
        sources.push('companies_house_profile');
      }
    } else {
      // Search by name, pick best match
      const results = await searchCompaniesHouse(clientName);
      if (results.length > 0) {
        const bestMatch = pickBestMatch(clientName, results);
        if (bestMatch) {
          const profile = await getCompanyProfile(bestMatch.companyNumber);
          if (profile.companyName) {
            applyCompanyProfile(enriched, profile);
            sources.push('companies_house_search');
            sources.push('companies_house_profile');
          }
        }
      }
    }

    // Fetch officers and filing history if we have a company number
    if (enriched.companyNumber) {
      const [officers, filings] = await Promise.all([
        getCompanyOfficers(enriched.companyNumber),
        getCompanyFilingHistory(enriched.companyNumber),
      ]);

      if (officers.length > 0) {
        enriched.officers = officers.map((o) => ({
          name: o.name,
          role: o.role,
          appointedOn: o.appointedOn,
        }));
        sources.push('companies_house_officers');
      }

      if (filings.length > 0) {
        enriched.recentFilings = filings.slice(0, 10).map((f) => ({
          date: f.date,
          description: f.description,
        }));
        sources.push('companies_house_filings');
      }
    }
  } catch (err) {
    console.error('[Enrichment] Companies House lookup failed:', err instanceof Error ? err.message : err);
  }

  // Step 2: Web scraping — run searches in parallel
  const searchName = enriched.companyName || clientName;

  try {
    // Use Apify for better results when available
    const searchFn = isApifyAvailable() ? searchGoogle : searchWeb;

    const [linkedinResults, charityResults, websiteResults, linkedinProfile] = await Promise.all([
      searchFn(`"${searchName}" site:linkedin.com`).catch(() => []),
      searchFn(`"${searchName}" charity commission UK`).catch(() => []),
      searchFn(`"${searchName}" official website UK`).catch(() => []),
      isApifyAvailable() ? scrapeLinkedIn(searchName).catch(() => null) : Promise.resolve(null),
    ]);

    // LinkedIn — prefer Apify direct scrape, fall back to search
    if (linkedinProfile) {
      enriched.linkedinUrl = linkedinProfile.url;
      enriched.linkedinSummary = `${linkedinProfile.description} | Industry: ${linkedinProfile.industry} | Employees: ${linkedinProfile.employeeCount}`;
      if (linkedinProfile.website) enriched.websiteUrl = linkedinProfile.website;
      sources.push('linkedin_apify');
    } else {
      const linkedinHit = linkedinResults.find((r) => r.url.includes('linkedin.com/company'));
      if (linkedinHit) {
        enriched.linkedinUrl = linkedinHit.url;
        enriched.linkedinSummary = linkedinHit.snippet;
        sources.push('linkedin');
      }
    }

    // Charity Commission
    const charityHit = charityResults.find(
      (r) =>
        r.url.includes('register-of-charities.charitycommission.gov.uk') ||
        r.url.includes('charitycommission.gov.uk')
    );
    if (charityHit) {
      // Try to extract charity number from URL
      const charityNumMatch = charityHit.url.match(/\/(\d{6,8})(?:\/|$)/);
      if (charityNumMatch) {
        enriched.charityNumber = charityNumMatch[1];
      }
      enriched.charityCommissionData = charityHit.snippet;
      sources.push('charity_commission');

      // Attempt to scrape charity page for more data
      try {
        const charityHtml = await fetchPage(charityHit.url);
        const charityText = await extractText(charityHtml);
        if (charityText.length > enriched.charityCommissionData.length) {
          enriched.charityCommissionData = charityText.slice(0, 2000);
        }
      } catch {
        // Non-critical — snippet is enough
      }
    }

    // Website
    const websiteHit = websiteResults.find(
      (r) =>
        !r.url.includes('linkedin.com') &&
        !r.url.includes('facebook.com') &&
        !r.url.includes('twitter.com') &&
        !r.url.includes('companies-house') &&
        !r.url.includes('charitycommission')
    );
    if (websiteHit) {
      enriched.websiteUrl = websiteHit.url;
      sources.push('web_search');
    }
  } catch (err) {
    console.error('[Enrichment] Web scraping failed:', err instanceof Error ? err.message : err);
  }

  // Step 3: Grant history search
  try {
    const [grantResults, givingResults] = await Promise.all([
      searchWeb(`"${searchName}" grant awarded`).catch(() => []),
      searchWeb(`"${searchName}" 360giving`).catch(() => []),
    ]);

    const allGrantResults = [...grantResults, ...givingResults];
    const grants: Array<{ funder: string; amount?: string; date?: string; project?: string }> = [];

    for (const result of allGrantResults.slice(0, 5)) {
      // Try to extract grant info from snippets
      const grant = parseGrantFromSnippet(result.snippet, result.title);
      if (grant) {
        grants.push(grant);
      }
    }

    // Also try 360Giving GrantNav directly
    try {
      const grantNavHtml = await fetchPage(
        `https://grantnav.threesixtygiving.org/search?query=${encodeURIComponent(searchName)}`
      );
      const grantNavText = await extractText(grantNavHtml);
      const parsedGrants = parseGrantNavResults(grantNavText);
      grants.push(...parsedGrants);
    } catch {
      // Non-critical
    }

    if (grants.length > 0) {
      enriched.previousGrants = deduplicateGrants(grants);
      sources.push('grant_databases');
    }
  } catch (err) {
    console.error('[Enrichment] Grant search failed:', err instanceof Error ? err.message : err);
  }

  // Step 4: Build public records summary
  enriched.publicRecordsSummary = buildSummary(enriched);

  return enriched;
}

// ---- Internal helpers ----

function applyCompanyProfile(
  enriched: EnrichedClientData,
  profile: Awaited<ReturnType<typeof getCompanyProfile>>
): void {
  enriched.companyNumber = profile.companyNumber;
  enriched.companyName = profile.companyName;
  enriched.companyType = profile.companyType;
  enriched.companyStatus = profile.companyStatus;
  enriched.dateOfCreation = profile.dateOfCreation;
  enriched.sicCodes = profile.sicCodes;
  enriched.hasInsolvencyHistory = profile.hasInsolvencyHistory;

  const addr = profile.registeredAddress;
  if (addr && Object.values(addr).some(Boolean)) {
    enriched.registeredAddress = {};
    if (addr.line1) enriched.registeredAddress['line1'] = addr.line1;
    if (addr.line2) enriched.registeredAddress['line2'] = addr.line2;
    if (addr.locality) enriched.registeredAddress['city'] = addr.locality;
    if (addr.region) enriched.registeredAddress['county'] = addr.region;
    if (addr.postalCode) enriched.registeredAddress['postcode'] = addr.postalCode;
  }
}

function pickBestMatch(
  clientName: string,
  results: Awaited<ReturnType<typeof searchCompaniesHouse>>
): (typeof results)[0] | null {
  if (results.length === 0) return null;

  const normalised = clientName.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Prefer exact or close name match that is active
  for (const r of results) {
    const rNorm = r.companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (rNorm === normalised && r.companyStatus === 'active') {
      return r;
    }
  }

  // Prefer active companies
  const active = results.filter((r) => r.companyStatus === 'active');
  if (active.length > 0) return active[0];

  return results[0];
}

function parseGrantFromSnippet(
  snippet: string,
  title: string
): { funder: string; amount?: string; date?: string; project?: string } | null {
  if (!snippet && !title) return null;

  const text = `${title} ${snippet}`;

  // Try to extract funder name from common patterns
  const funderMatch = text.match(
    /(?:from|by|funded by|awarded by)\s+([A-Z][A-Za-z\s&]+?)(?:\s*[,.\-|]|\s+(?:for|to|of|in))/
  );
  const funder = funderMatch ? funderMatch[1].trim() : title.split(/[|\-–]/)[0].trim();

  // Try to extract amount
  const amountMatch = text.match(/[£$][\d,]+(?:\.\d{2})?/);
  const amount = amountMatch ? amountMatch[0] : undefined;

  // Try to extract date
  const dateMatch = text.match(
    /(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2})/i
  );
  const date = dateMatch ? dateMatch[0] : undefined;

  if (!funder) return null;

  return { funder, amount, date };
}

function parseGrantNavResults(
  text: string
): Array<{ funder: string; amount?: string; date?: string; project?: string }> {
  const grants: Array<{ funder: string; amount?: string; date?: string; project?: string }> = [];

  // GrantNav text typically contains lines with grant data
  const lines = text.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    // Look for lines containing amounts and funder names
    const amountMatch = line.match(/[£][\d,]+/);
    if (amountMatch) {
      const parts = line.split(/\s{2,}/).filter(Boolean);
      if (parts.length >= 2) {
        grants.push({
          funder: parts[0].trim(),
          amount: amountMatch[0],
          project: parts.length > 2 ? parts[parts.length - 1].trim() : undefined,
        });
      }
    }

    // Cap at 10
    if (grants.length >= 10) break;
  }

  return grants;
}

function deduplicateGrants(
  grants: Array<{ funder: string; amount?: string; date?: string; project?: string }>
): typeof grants {
  const seen = new Set<string>();
  return grants.filter((g) => {
    const key = `${g.funder.toLowerCase()}-${g.amount ?? ''}-${g.date ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSummary(enriched: EnrichedClientData): string {
  const parts: string[] = [];

  if (enriched.companyName) {
    parts.push(`${enriched.companyName} (${enriched.companyType ?? 'unknown type'}) — ${enriched.companyStatus ?? 'unknown status'}.`);
  }

  if (enriched.dateOfCreation) {
    parts.push(`Incorporated: ${enriched.dateOfCreation}.`);
  }

  if (enriched.officers && enriched.officers.length > 0) {
    const directorNames = enriched.officers.slice(0, 3).map((o) => o.name).join(', ');
    parts.push(`Key officers: ${directorNames}.`);
  }

  if (enriched.charityNumber) {
    parts.push(`Charity number: ${enriched.charityNumber}.`);
  }

  if (enriched.hasInsolvencyHistory) {
    parts.push('WARNING: Has insolvency history on record.');
  }

  if (enriched.previousGrants && enriched.previousGrants.length > 0) {
    parts.push(`Found ${enriched.previousGrants.length} previous grant(s) on public record.`);
  }

  parts.push(`Data sourced from: ${enriched.sources.join(', ')}.`);

  return parts.join(' ');
}
