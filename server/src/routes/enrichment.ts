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
 * POST /grants/scrape
 * Triggers a full grant portal scrape and stores results in the grant_opportunities table.
 */
enrichmentRouter.post(
  '/grants/scrape',
  asyncHandler(async (req, res) => {
    const { clientId } = req.body as { clientId?: string };
    const opportunities = await scrapeGrantPortals();

    // Store results in Supabase
    let stored = 0;
    if (opportunities.length > 0) {
      const rows = opportunities.map((opp) => ({
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
      }));

      // Clear old scraped data and insert fresh
      await supabase.from('grant_opportunities').delete().gt('created_at', '2000-01-01');

      const { error } = await supabase
        .from('grant_opportunities')
        .insert(rows);

      if (error) {
        console.error('[GrantScraper] Failed to store opportunities:', error.message);
      } else {
        stored = rows.length;
      }
    }

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
      details: { totalFound: opportunities.length, stored },
    });

    res.json({
      success: true,
      data: {
        totalFound: opportunities.length,
        stored,
        opportunities,
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
