import { supabase } from '../lib/supabase.js';
import type { AgentContext } from '../../../shared/types/agents.js';
import { searchCompaniesHouse, getCompanyProfile, getCompanyOfficers, getCompanyFilingHistory } from './companiesHouse.js';

/**
 * Assembles the context pack for an agent conversation.
 * Fetches organisation, client, documents (extracted_text only — never raw files),
 * applications, and relevant funders from the database.
 *
 * This is the single entry point for all agent context. Agents never query
 * the database directly — they receive this typed context object.
 */
export async function buildContext(
  orgId: string,
  clientId?: string,
  applicationId?: string
): Promise<AgentContext> {
  // Always fetch the organisation
  const { data: org, error: orgError } = await supabase
    .from('organisations')
    .select('id, name, plan')
    .eq('id', orgId)
    .single();

  if (orgError || !org) {
    throw new Error(`Organisation not found: ${orgId}`);
  }

  const context: AgentContext = {
    organisation: {
      id: org.id,
      name: org.name,
      plan: org.plan,
    },
  };

  // If a client is specified, fetch their record, documents, and applications
  if (clientId) {
    const [clientResult, docsResult, appsResult] = await Promise.all([
      supabase
        .from('clients')
        .select(
          'id, name, type, stage, status, primary_contact_name, annual_income, policies_held, existing_grants, registered_number, address'
        )
        .eq('id', clientId)
        .eq('organisation_id', orgId)
        .single(),

      // Only extracted_text — never raw file bytes (GDPR / Constraint 11)
      supabase
        .from('documents')
        .select('id, name, type, extracted_text')
        .eq('client_id', clientId)
        .eq('organisation_id', orgId)
        .order('created_at', { ascending: false }),

      supabase
        .from('applications')
        .select(
          'id, funder_name, status, gate1_passed, gate2_passed, gate2_risk_level, gate3_passed, operator_approval'
        )
        .eq('client_id', clientId)
        .eq('organisation_id', orgId)
        .order('created_at', { ascending: false }),
    ]);

    if (clientResult.data) {
      context.client = {
        id: clientResult.data.id,
        name: clientResult.data.name,
        type: clientResult.data.type,
        stage: clientResult.data.stage,
        status: clientResult.data.status,
        primary_contact_name: clientResult.data.primary_contact_name,
        annual_income: clientResult.data.annual_income,
        policies_held: clientResult.data.policies_held,
        existing_grants: clientResult.data.existing_grants ?? [],
        registered_number: clientResult.data.registered_number,
        address: clientResult.data.address,
      };

      // Fetch Companies House data if registered number available
      const regNum = clientResult.data.registered_number as string | null;
      if (regNum) {
        try {
          const [profile, officers, filings] = await Promise.all([
            getCompanyProfile(regNum).catch(() => null),
            getCompanyOfficers(regNum).catch(() => []),
            getCompanyFilingHistory(regNum).catch(() => []),
          ]);

          if (profile) {
            const addr = profile.registeredAddress;
            context.companiesHouse = {
              companyNumber: profile.companyNumber,
              companyName: profile.companyName,
              companyType: profile.companyType,
              companyStatus: profile.companyStatus,
              dateOfCreation: profile.dateOfCreation,
              registeredAddress: [addr.line1, addr.line2, addr.locality, addr.region, addr.postalCode].filter(Boolean).join(', '),
              sicCodes: profile.sicCodes ?? [],
              officers: officers.map((o) => ({ name: o.name, role: o.role, appointedOn: o.appointedOn })),
              recentFilings: filings.slice(0, 5).map((f) => ({ date: f.date, description: f.description })),
              hasInsolvencyHistory: profile.hasInsolvencyHistory,
            };
          }
        } catch {
          // Companies House unavailable — continue without it
        }
      } else {
        // Try searching by company name
        try {
          const searchResults = await searchCompaniesHouse(clientResult.data.name);
          if (searchResults.length > 0) {
            const best = searchResults[0]!;
            const [profile, officers, filings] = await Promise.all([
              getCompanyProfile(best.companyNumber).catch(() => null),
              getCompanyOfficers(best.companyNumber).catch(() => []),
              getCompanyFilingHistory(best.companyNumber).catch(() => []),
            ]);

            if (profile) {
              const addr = profile.registeredAddress;
              context.companiesHouse = {
                companyNumber: profile.companyNumber,
                companyName: profile.companyName,
                companyType: profile.companyType,
                companyStatus: profile.companyStatus,
                dateOfCreation: profile.dateOfCreation,
                registeredAddress: [addr.line1, addr.line2, addr.locality, addr.region, addr.postalCode].filter(Boolean).join(', '),
                sicCodes: profile.sicCodes ?? [],
                officers: officers.map((o) => ({ name: o.name, role: o.role, appointedOn: o.appointedOn })),
                recentFilings: filings.slice(0, 5).map((f) => ({ date: f.date, description: f.description })),
                hasInsolvencyHistory: profile.hasInsolvencyHistory,
              };
            }
          }
        } catch {
          // Search failed — continue without it
        }
      }
    }

    if (docsResult.data) {
      context.documents = docsResult.data.map((doc) => ({
        id: doc.id,
        name: doc.name,
        type: doc.type,
        extracted_text: doc.extracted_text,
      }));
    }

    if (appsResult.data) {
      context.applications = appsResult.data.map((app) => ({
        id: app.id,
        funder_name: app.funder_name,
        status: app.status,
        gate1_passed: app.gate1_passed,
        gate2_passed: app.gate2_passed,
        gate2_risk_level: app.gate2_risk_level,
        gate3_passed: app.gate3_passed,
        operator_approval: app.operator_approval,
      }));
    }
  }

  // If a specific application is requested, fetch it with full gate history
  if (applicationId) {
    const { data: app } = await supabase
      .from('applications')
      .select(
        'id, funder_name, status, gate1_passed, gate1_report, gate1_checked_at, gate2_passed, gate2_report, gate2_risk_level, gate2_checked_at, gate3_passed, gate3_report, gate3_checked_at, operator_approval, operator_approved_at, amount_requested, deadline, project_name, project_description'
      )
      .eq('id', applicationId)
      .eq('organisation_id', orgId)
      .single();

    if (app) {
      // If we already have applications from the client fetch, replace
      // the matching entry with the detailed version. Otherwise, create the array.
      const detailed = {
        id: app.id,
        funder_name: app.funder_name,
        status: app.status,
        gate1_passed: app.gate1_passed,
        gate2_passed: app.gate2_passed,
        gate2_risk_level: app.gate2_risk_level,
        gate3_passed: app.gate3_passed,
        operator_approval: app.operator_approval,
      };

      if (context.applications) {
        const idx = context.applications.findIndex((a) => a.id === applicationId);
        if (idx >= 0) {
          context.applications[idx] = detailed;
        } else {
          context.applications.push(detailed);
        }
      } else {
        context.applications = [detailed];
      }
    }
  }

  // Fetch relevant funders for the organisation
  // Includes both org-specific and platform-wide (organisation_id IS NULL) funders
  const { data: funders } = await supabase
    .from('funders')
    .select('id, name, grant_range_min, grant_range_max, eligible_structures, open_rounds')
    .or(`organisation_id.eq.${orgId},organisation_id.is.null`)
    .order('name', { ascending: true });

  if (funders) {
    context.funders = funders.map((f) => ({
      id: f.id,
      name: f.name,
      grant_range_min: f.grant_range_min,
      grant_range_max: f.grant_range_max,
      eligible_structures: f.eligible_structures,
      open_rounds: f.open_rounds ?? [],
    }));
  }

  return context;
}
