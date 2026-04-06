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
    const { clientType, geography, sector } = req.body as {
      clientType?: string;
      geography?: string;
      sector?: string;
    };

    if (!clientType || !geography) {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'clientType and geography are required' },
      });
      return;
    }

    const opportunities = await searchGrantsForClient(clientType, geography, sector);
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
