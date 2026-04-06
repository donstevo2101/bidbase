/**
 * Enrichment routes for BidBase.
 * Provides data enrichment, Companies House proxy, and grant discovery endpoints.
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { enrichClientData } from '../agents/dataEnrichment.js';
import { searchCompaniesHouse, getCompanyProfile } from '../agents/companiesHouse.js';
import { searchGrantsForClient, scrapeGrantPortals } from '../agents/grantScraper.js';
import { scoreGrantRisk } from '../agents/grantRiskScorer.js';
import { fetch360GivingFunders } from '../agents/threeSixtyGiving.js';
import type { GrantOpportunity } from '../agents/grantScraper.js';
import type { Request, Response, NextFunction } from 'express';

export const enrichmentRouter = Router();

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// All routes require authentication
enrichmentRouter.use(authMiddleware);

/**
 * POST /enrich
 * Enriches a client's data from Companies House, web scraping, and grant databases.
 */
enrichmentRouter.post(
  '/enrich',
  asyncHandler(async (req, res) => {
    const { clientName, registeredNumber, clientId } = req.body as {
      clientName?: string;
      registeredNumber?: string;
      clientId?: string;
    };

    if (!clientName) {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'clientName is required' },
      });
      return;
    }

    const enriched = await enrichClientData(clientName, registeredNumber);

    // Auto-update client record if clientId provided
    if (clientId) {
      try {
        const updateData: Record<string, unknown> = {};

        if (enriched.companyNumber && !registeredNumber) {
          updateData['registered_number'] = enriched.companyNumber;
        }
        if (enriched.registeredAddress) {
          updateData['address'] = enriched.registeredAddress;
        }
        if (enriched.companyType) {
          const typeMap: Record<string, string> = {
            'community-interest-company': 'CIC',
            'registered-charity': 'charity',
          };
          const mappedType = typeMap[enriched.companyType];
          if (mappedType) {
            updateData['type'] = mappedType;
          }
        }
        if (enriched.previousGrants && enriched.previousGrants.length > 0) {
          updateData['existing_grants'] = enriched.previousGrants.map((g) => ({
            funder: g.funder,
            amount: g.amount,
            open_until: g.date,
          }));
        }

        if (Object.keys(updateData).length > 0) {
          await supabase.from('clients').update(updateData).eq('id', clientId);
        }

        // Log enrichment activity
        await supabase.from('activity_log').insert({
          organisation_id: req.user.org_id,
          client_id: clientId,
          actor_type: 'system',
          action: 'client_enriched',
          details: { sources: enriched.sources, fieldsUpdated: Object.keys(updateData) },
        });
      } catch (err) {
        console.error('[Enrichment] Failed to update client record:', err);
        // Non-critical — still return the enriched data
      }
    }

    res.json({ success: true, data: enriched });
  })
);

/**
 * GET /companies-house/search?q=QUERY
 * Proxies Companies House company search.
 */
enrichmentRouter.get(
  '/companies-house/search',
  asyncHandler(async (req, res) => {
    const query = req.query['q'] as string;

    if (!query) {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Query parameter q is required' },
      });
      return;
    }

    const results = await searchCompaniesHouse(query);
    res.json({ success: true, data: results });
  })
);

/**
 * GET /companies-house/:companyNumber
 * Proxies Companies House company profile lookup.
 */
enrichmentRouter.get(
  '/companies-house/:companyNumber',
  asyncHandler(async (req, res) => {
    const { companyNumber } = req.params;

    if (!companyNumber) {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Company number is required' },
      });
      return;
    }

    const profile = await getCompanyProfile(companyNumber);
    res.json({ success: true, data: profile });
  })
);

/**
 * POST /grants/search
 * Searches for grant opportunities matching a client profile.
 */
enrichmentRouter.post(
  '/grants/search',
  asyncHandler(async (req, res) => {
    const { clientType, geography, sector, clientId } = req.body as {
      clientType?: string;
      geography?: string;
      sector?: string;
      clientId?: string;
    };

    if (!clientType || !geography) {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'clientType and geography are required' },
      });
      return;
    }

    const opportunities = await searchGrantsForClient(clientType, geography, sector);

    // If clientId provided, score risk for each opportunity
    if (clientId) {
      const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .eq('organisation_id', req.user.org_id)
        .single();

      if (client) {
        const scored = await Promise.allSettled(
          opportunities.map(async (opp) => {
            const result = await scoreGrantRisk(
              opp,
              client.type ?? clientType,
              client.policies_held ?? undefined,
              geography,
              client.annual_income ?? undefined
            );
            opp.riskScore = result.score;
            return opp;
          })
        );

        // Replace opportunities with scored versions where available
        for (let i = 0; i < scored.length; i++) {
          if (scored[i].status === 'fulfilled') {
            opportunities[i] = (scored[i] as PromiseFulfilledResult<GrantOpportunity>).value;
          }
        }
      }
    }

    res.json({ success: true, data: opportunities });
  })
);

/**
 * Upserts scraped grants into the database.
 * Returns counts of new and updated grants.
 */
async function upsertScrapedGrants(opportunities: GrantOpportunity[]): Promise<{ newGrants: number; updatedGrants: number }> {
  let newGrants = 0;
  let updatedGrants = 0;

  for (const opp of opportunities) {
    const row = {
      title: opp.title,
      funder: opp.funder,
      url: opp.url,
      amount: opp.amount ?? null,
      deadline: opp.deadline ?? null,
      eligibility: opp.eligibility ?? null,
      description: opp.description ?? null,
      source: opp.source,
      scraped_at: opp.scrapedAt,
      open_date: opp.openDate ?? null,
      close_date: opp.closeDate ?? null,
      status: opp.status ?? 'open',
      previous_awards: opp.previousAwards ?? null,
      total_applicants: opp.totalApplicants ?? null,
      average_award: opp.averageAward ?? null,
      sectors: opp.sectors ?? null,
    };

    // Check if grant already exists (match on title + funder, case-insensitive)
    const { data: existing } = await supabase
      .from('grant_opportunities')
      .select('id, deadline, status, amount, description')
      .ilike('title', opp.title)
      .ilike('funder', opp.funder)
      .limit(1);

    if (existing && existing.length > 0) {
      // Update if any tracked fields changed
      const ex = existing[0];
      const changes: Record<string, unknown> = {};

      if (row.deadline !== ex.deadline) changes['deadline'] = row.deadline;
      if (row.close_date !== null) changes['close_date'] = row.close_date;
      if (row.open_date !== null) changes['open_date'] = row.open_date;
      if (row.status !== ex.status) changes['status'] = row.status;
      if (row.amount !== ex.amount) changes['amount'] = row.amount;
      if (row.description && row.description !== ex.description) changes['description'] = row.description;
      changes['scraped_at'] = row.scraped_at;
      changes['url'] = row.url;

      if (Object.keys(changes).length > 1) {
        // More than just scraped_at changed
        await supabase.from('grant_opportunities').update(changes).eq('id', ex.id);
        updatedGrants++;
      }
    } else {
      // Insert new grant
      const { error } = await supabase.from('grant_opportunities').insert(row);
      if (!error) {
        newGrants++;
      } else {
        console.error('[GrantScraper] Failed to insert grant:', error.message);
      }
    }
  }

  return { newGrants, updatedGrants };
}

/**
 * Marks grants with close_date in the past as status='closed'.
 */
async function markExpiredGrantsClosed(): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);
  await supabase
    .from('grant_opportunities')
    .update({ status: 'closed' })
    .lt('close_date', todayStr)
    .neq('status', 'closed');
}

/**
 * After scraping, sync unique funders from grant_opportunities into the funders table.
 * Creates platform-wide funders (organisation_id = null) so they appear in the Funders nav tab.
 */
async function syncFundersFromGrants(): Promise<number> {
  // Get all unique funder names from grant_opportunities
  const { data: grantFunders } = await supabase
    .from('grant_opportunities')
    .select('funder, url, amount, eligibility, sectors, open_date, close_date')
    .not('funder', 'is', null);

  if (!grantFunders || grantFunders.length === 0) return 0;

  // Deduplicate funder names
  const funderMap = new Map<string, {
    name: string;
    website: string | null;
    grantRangeMin: number | null;
    grantRangeMax: number | null;
    eligibleStructures: string[];
    openRounds: Array<{ name: string; closes: string | null }>;
    grantCount: number;
  }>();

  for (const g of grantFunders) {
    const name = (g.funder as string).trim();
    if (!name || name.length < 3) continue;

    const existing = funderMap.get(name.toLowerCase());
    if (existing) {
      existing.grantCount++;
      // Parse amount ranges
      const amtMatch = (g.amount as string | null)?.match(/[\d,]+/g);
      if (amtMatch) {
        const nums = amtMatch.map((n: string) => parseInt(n.replace(/,/g, ''), 10)).filter((n: number) => !isNaN(n));
        if (nums.length > 0) {
          const min = Math.min(...nums);
          const max = Math.max(...nums);
          if (!existing.grantRangeMin || min < existing.grantRangeMin) existing.grantRangeMin = min;
          if (!existing.grantRangeMax || max > existing.grantRangeMax) existing.grantRangeMax = max;
        }
      }
      if (g.close_date) {
        existing.openRounds.push({ name: 'Grant round', closes: g.close_date as string });
      }
    } else {
      const amtMatch = (g.amount as string | null)?.match(/[\d,]+/g);
      let gMin: number | null = null;
      let gMax: number | null = null;
      if (amtMatch) {
        const nums = amtMatch.map((n: string) => parseInt(n.replace(/,/g, ''), 10)).filter((n: number) => !isNaN(n));
        if (nums.length > 0) { gMin = Math.min(...nums); gMax = Math.max(...nums); }
      }

      // Extract eligible structures from eligibility text
      const eligText = ((g.eligibility as string | null) ?? '').toLowerCase();
      const structures: string[] = [];
      if (eligText.includes('cic')) structures.push('CIC');
      if (eligText.includes('charit')) structures.push('charity');
      if (eligText.includes('social enterprise')) structures.push('social_enterprise');
      if (eligText.includes('community group') || eligText.includes('constituted')) structures.push('community_group');

      funderMap.set(name.toLowerCase(), {
        name,
        website: (g.url as string | null) ?? null,
        grantRangeMin: gMin,
        grantRangeMax: gMax,
        eligibleStructures: structures,
        openRounds: g.close_date ? [{ name: 'Grant round', closes: g.close_date as string }] : [],
        grantCount: 1,
      });
    }
  }

  // Upsert each funder into the funders table (platform-wide: organisation_id = null)
  let created = 0;
  for (const [, funder] of funderMap) {
    // Check if funder already exists
    const { data: existing } = await supabase
      .from('funders')
      .select('id')
      .is('organisation_id', null)
      .ilike('name', funder.name)
      .limit(1);

    if (existing && existing.length > 0) {
      // Update with latest data
      await supabase.from('funders').update({
        website: funder.website,
        grant_range_min: funder.grantRangeMin,
        grant_range_max: funder.grantRangeMax,
        eligible_structures: funder.eligibleStructures.length > 0 ? funder.eligibleStructures : null,
        open_rounds: funder.openRounds.length > 0 ? funder.openRounds : [],
        last_updated: new Date().toISOString(),
      }).eq('id', existing[0]!.id);
    } else {
      // Create new platform-wide funder
      await supabase.from('funders').insert({
        organisation_id: null,
        name: funder.name,
        website: funder.website,
        grant_range_min: funder.grantRangeMin,
        grant_range_max: funder.grantRangeMax,
        eligible_structures: funder.eligibleStructures.length > 0 ? funder.eligibleStructures : null,
        open_rounds: funder.openRounds.length > 0 ? funder.openRounds : [],
        verified: false,
      });
      created++;
    }
  }

  console.log(`[FunderSync] Synced ${funderMap.size} funders, ${created} new`);
  return created;
}

/**
 * POST /funders/sync-360giving
 * Fetches funder data from 360Giving GrantNav and upserts into the funders table
 * as platform-wide funders (organisation_id = null).
 */
enrichmentRouter.post(
  '/funders/sync-360giving',
  asyncHandler(async (req, res) => {
    console.log('[360Giving] Starting sync...');
    const records = await fetch360GivingFunders();

    let created = 0;
    let updated = 0;

    for (const record of records) {
      // Store 360Giving stats in the notes field as JSON
      const statsJson = JSON.stringify({
        source: '360giving',
        totalGrants: record.totalGrants,
        grantsToOrgs: record.grantsToOrgs,
        grantsToIndividuals: record.grantsToIndividuals,
        totalToOrgs: record.totalToOrgs,
        totalToIndividuals: record.totalToIndividuals,
        latestAward: record.latestAward,
        earliestAward: record.earliestAward,
        grantNavUrl: record.grantNavUrl,
        syncedAt: new Date().toISOString(),
      });

      // Check if funder already exists (platform-wide)
      const { data: existing } = await supabase
        .from('funders')
        .select('id')
        .is('organisation_id', null)
        .ilike('name', record.name)
        .limit(1);

      if (existing && existing.length > 0) {
        await supabase.from('funders').update({
          notes: statsJson,
          last_updated: new Date().toISOString(),
        }).eq('id', existing[0]!.id);
        updated++;
      } else {
        await supabase.from('funders').insert({
          organisation_id: null,
          name: record.name,
          notes: statsJson,
          verified: false,
        });
        created++;
      }
    }

    // Log the sync
    await supabase.from('activity_log').insert({
      organisation_id: req.user.org_id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'funders_360giving_synced',
      details: { totalFetched: records.length, created, updated },
    });

    console.log(`[360Giving] Sync complete: ${created} created, ${updated} updated`);

    res.json({
      success: true,
      data: { totalFetched: records.length, created, updated },
    });
  })
);

/**
 * POST /grants/scrape
 * Triggers a full grant portal scrape and upserts results into the grant_opportunities table.
 * Also syncs unique funders into the funders table for the Funders nav tab.
 */
enrichmentRouter.post(
  '/grants/scrape',
  asyncHandler(async (req, res) => {
    const { clientId } = req.body as { clientId?: string };
    const opportunities = await scrapeGrantPortals();

    // Upsert results into Supabase (no delete — preserve history)
    const { newGrants, updatedGrants } = await upsertScrapedGrants(opportunities);

    // Mark expired grants as closed
    await markExpiredGrantsClosed();

    // Sync funders from scraped grants into the funders table
    const newFunders = await syncFundersFromGrants();

    // Get total count in database
    const { count: totalInDatabase } = await supabase
      .from('grant_opportunities')
      .select('id', { count: 'exact', head: true });

    // If clientId provided, score risk for each opportunity
    if (clientId) {
      const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .eq('organisation_id', req.user.org_id)
        .single();

      if (client) {
        const scored = await Promise.allSettled(
          opportunities.map(async (opp) => {
            const result = await scoreGrantRisk(
              opp,
              client.type ?? 'charity',
              client.policies_held ?? undefined,
              undefined,
              client.annual_income ?? undefined
            );
            opp.riskScore = result.score;
            return opp;
          })
        );

        for (let i = 0; i < scored.length; i++) {
          if (scored[i].status === 'fulfilled') {
            opportunities[i] = (scored[i] as PromiseFulfilledResult<GrantOpportunity>).value;
          }
        }
      }
    }

    // Log the scrape
    await supabase.from('activity_log').insert({
      organisation_id: req.user.org_id,
      actor_id: req.user.id,
      actor_type: 'user',
      action: 'grants_scraped',
      details: { totalFound: opportunities.length, newGrants, updatedGrants, newFunders, totalInDatabase: totalInDatabase ?? 0 },
    });

    res.json({
      success: true,
      data: {
        totalFound: opportunities.length,
        newGrants,
        updatedGrants,
        newFunders,
        totalInDatabase: totalInDatabase ?? 0,
        opportunities,
      },
    });
  })
);

/**
 * GET /grants/database
 * Returns all grants from the database with filtering, pagination, and computed fields.
 */
enrichmentRouter.get(
  '/grants/database',
  asyncHandler(async (req, res) => {
    const status = (req.query['status'] as string) ?? 'all';
    const source = req.query['source'] as string | undefined;
    const funder = req.query['funder'] as string | undefined;
    const search = req.query['search'] as string | undefined;
    const eligibleFor = req.query['eligibleFor'] as string | undefined;
    const closingWithin = req.query['closingWithin'] ? parseInt(req.query['closingWithin'] as string, 10) : undefined;
    const page = Math.max(1, parseInt((req.query['page'] as string) ?? '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt((req.query['limit'] as string) ?? '50', 10)));
    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from('grant_opportunities')
      .select('*', { count: 'exact' });

    // Status filter
    if (status !== 'all') {
      query = query.eq('status', status);
    }

    // Source filter
    if (source) {
      query = query.eq('source', source);
    }

    // Funder filter (case-insensitive partial match)
    if (funder) {
      query = query.ilike('funder', `%${funder}%`);
    }

    // Search filter (title or description)
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Eligibility filter (check eligibility text)
    if (eligibleFor) {
      query = query.ilike('eligibility', `%${eligibleFor}%`);
    }

    // Closing within X days
    if (closingWithin && closingWithin > 0) {
      const now = new Date();
      const futureDate = new Date(now.getTime() + closingWithin * 24 * 60 * 60 * 1000);
      query = query
        .gte('close_date', now.toISOString().slice(0, 10))
        .lte('close_date', futureDate.toISOString().slice(0, 10));
    }

    // Sort: open grants first (by status), then by close_date ascending
    query = query
      .order('status', { ascending: true })
      .order('close_date', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);

    const { data: grants, error, count } = await query;

    if (error) {
      console.error('[GrantDatabase] Query error:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'QUERY_ERROR', message: 'Failed to fetch grants from database' },
      });
      return;
    }

    const now = new Date();

    // Compute daysRemaining and ragStatus for each grant
    const enrichedGrants = (grants ?? []).map((g: Record<string, unknown>) => {
      const closeDate = g['close_date'] as string | null;
      let daysRemaining: number | null = null;
      let ragStatus: 'red' | 'amber' | 'green' | 'grey' = 'grey';

      if (closeDate && g['status'] !== 'closed') {
        const close = new Date(closeDate as string);
        daysRemaining = Math.ceil((close.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (daysRemaining < 0) {
          daysRemaining = 0;
          ragStatus = 'grey';
        } else if (daysRemaining <= 7) {
          ragStatus = 'red';
        } else if (daysRemaining <= 14) {
          ragStatus = 'amber';
        } else {
          ragStatus = 'green';
        }
      }

      return {
        ...g,
        daysRemaining,
        ragStatus,
      };
    });

    // Get unique sources for filter dropdown
    const { data: sourcesData } = await supabase
      .from('grant_opportunities')
      .select('source')
      .limit(500);

    const uniqueSources = [...new Set((sourcesData ?? []).map((s: Record<string, unknown>) => s['source'] as string))].filter(Boolean);

    // Get stats
    const { count: totalCount } = await supabase
      .from('grant_opportunities')
      .select('id', { count: 'exact', head: true });

    const { count: openCount } = await supabase
      .from('grant_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open');

    const { count: closedCount } = await supabase
      .from('grant_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'closed');

    // Closing this week count
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { count: closingThisWeekCount } = await supabase
      .from('grant_opportunities')
      .select('id', { count: 'exact', head: true })
      .gte('close_date', now.toISOString().slice(0, 10))
      .lte('close_date', weekFromNow.toISOString().slice(0, 10))
      .neq('status', 'closed');

    // Last scraped timestamp
    const { data: lastScraped } = await supabase
      .from('grant_opportunities')
      .select('scraped_at')
      .order('scraped_at', { ascending: false })
      .limit(1);

    const lastScrapedAt = lastScraped && lastScraped.length > 0 ? lastScraped[0]['scraped_at'] : null;

    res.json({
      success: true,
      data: enrichedGrants,
      stats: {
        total: totalCount ?? 0,
        open: openCount ?? 0,
        closingThisWeek: closingThisWeekCount ?? 0,
        closed: closedCount ?? 0,
        lastScrapedAt,
      },
      sources: uniqueSources,
      pagination: {
        page,
        limit,
        total: count ?? 0,
      },
    });
  })
);

/**
 * POST /grants/score
 * Scores the risk/likelihood of a client succeeding with a specific grant.
 */
enrichmentRouter.post(
  '/grants/score',
  asyncHandler(async (req, res) => {
    const { grant, clientId } = req.body as {
      grant?: GrantOpportunity;
      clientId?: string;
    };

    if (!grant || !clientId) {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'grant and clientId are required' },
      });
      return;
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .eq('organisation_id', req.user.org_id)
      .single();

    if (clientError || !client) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Client not found' },
      });
      return;
    }

    // Extract geography from client address if available
    const address = client.address as Record<string, unknown> | null;
    const geography = address
      ? [address['region'], address['city'], address['county']].filter(Boolean).join(', ')
      : undefined;

    const result = await scoreGrantRisk(
      grant,
      client.type ?? 'charity',
      client.policies_held ?? undefined,
      geography || undefined,
      client.annual_income ?? undefined
    );

    res.json({ success: true, data: result });
  })
);
