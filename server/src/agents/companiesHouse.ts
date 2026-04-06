/**
 * Companies House API integration for BidBase.
 * Uses the UK Companies House REST API with basic auth.
 */

// ---- Types ----

export interface CompanySearchResult {
  companyNumber: string;
  companyName: string;
  companyType: string;
  companyStatus: string;
  dateOfCreation: string;
  registeredAddress: {
    line1?: string;
    line2?: string;
    locality?: string;
    region?: string;
    postalCode?: string;
  };
}

export interface CompanyProfile extends CompanySearchResult {
  sicCodes: string[];
  accounts: { lastMadeUpTo?: string; nextDue?: string };
  confirmationStatement: { lastMadeUpTo?: string; nextDue?: string };
  hasCharges: boolean;
  hasInsolvencyHistory: boolean;
}

export interface Filing {
  date: string;
  category: string;
  description: string;
}

export interface Officer {
  name: string;
  role: string;
  appointedOn: string;
  nationality?: string;
}

// ---- Internal helpers ----

const BASE_URL = 'https://api.company-information.service.gov.uk';

function getApiKey(): string | null {
  return process.env['COMPANIES_HOUSE_API_KEY'] ?? null;
}

async function chRequest(path: string): Promise<Record<string, unknown> | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[CompaniesHouse] No API key set (COMPANIES_HOUSE_API_KEY). Returning empty results.');
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    // Companies House uses basic auth: API key as username, empty password
    const credentials = Buffer.from(`${apiKey}:`).toString('base64');

    const response = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 404) return null;
      console.error(`[CompaniesHouse] API error: ${response.status} ${response.statusText} for ${path}`);
      return null;
    }

    return (await response.json()) as Record<string, unknown>;
  } catch (err) {
    console.error('[CompaniesHouse] Request failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ---- Exported functions ----

/**
 * Search Companies House by company name or number.
 */
export async function searchCompaniesHouse(query: string): Promise<CompanySearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const data = await chRequest(`/search/companies?q=${encodedQuery}&items_per_page=10`);

  if (!data || !Array.isArray(data['items'])) return [];

  const items = data['items'] as Record<string, unknown>[];

  return items.map((item) => {
    const address = (item['registered_office_address'] ?? {}) as Record<string, string>;
    return {
      companyNumber: String(item['company_number'] ?? ''),
      companyName: String(item['title'] ?? ''),
      companyType: String(item['company_type'] ?? ''),
      companyStatus: String(item['company_status'] ?? ''),
      dateOfCreation: String(item['date_of_creation'] ?? ''),
      registeredAddress: {
        line1: address['address_line_1'],
        line2: address['address_line_2'],
        locality: address['locality'],
        region: address['region'],
        postalCode: address['postal_code'],
      },
    };
  });
}

/**
 * Get detailed company profile by company number.
 */
export async function getCompanyProfile(companyNumber: string): Promise<CompanyProfile> {
  const data = await chRequest(`/company/${encodeURIComponent(companyNumber)}`);

  if (!data) {
    return {
      companyNumber,
      companyName: '',
      companyType: '',
      companyStatus: '',
      dateOfCreation: '',
      registeredAddress: {},
      sicCodes: [],
      accounts: {},
      confirmationStatement: {},
      hasCharges: false,
      hasInsolvencyHistory: false,
    };
  }

  const address = (data['registered_office_address'] ?? {}) as Record<string, string>;
  const accounts = (data['accounts'] ?? {}) as Record<string, unknown>;
  const accountsRef = (accounts['last_accounts'] ?? {}) as Record<string, string>;
  const confStmt = (data['confirmation_statement'] ?? {}) as Record<string, string>;

  return {
    companyNumber: String(data['company_number'] ?? companyNumber),
    companyName: String(data['company_name'] ?? ''),
    companyType: String(data['type'] ?? ''),
    companyStatus: String(data['company_status'] ?? ''),
    dateOfCreation: String(data['date_of_creation'] ?? ''),
    registeredAddress: {
      line1: address['address_line_1'],
      line2: address['address_line_2'],
      locality: address['locality'],
      region: address['region'],
      postalCode: address['postal_code'],
    },
    sicCodes: Array.isArray(data['sic_codes']) ? (data['sic_codes'] as string[]) : [],
    accounts: {
      lastMadeUpTo: accountsRef['made_up_to'] ?? undefined,
      nextDue: String(accounts['next_due'] ?? '') || undefined,
    },
    confirmationStatement: {
      lastMadeUpTo: confStmt['last_made_up_to'] ?? undefined,
      nextDue: confStmt['next_due'] ?? undefined,
    },
    hasCharges: Boolean(data['has_charges']),
    hasInsolvencyHistory: Boolean(data['has_insolvency_history']),
  };
}

/**
 * Get filing history for a company.
 */
export async function getCompanyFilingHistory(companyNumber: string): Promise<Filing[]> {
  const data = await chRequest(
    `/company/${encodeURIComponent(companyNumber)}/filing-history?items_per_page=20`
  );

  if (!data || !Array.isArray(data['items'])) return [];

  const items = data['items'] as Record<string, unknown>[];

  return items.map((item) => ({
    date: String(item['date'] ?? ''),
    category: String(item['category'] ?? ''),
    description: String(item['description'] ?? ''),
  }));
}

/**
 * Get officers (directors, secretaries) for a company.
 */
export async function getCompanyOfficers(companyNumber: string): Promise<Officer[]> {
  const data = await chRequest(
    `/company/${encodeURIComponent(companyNumber)}/officers?items_per_page=50`
  );

  if (!data || !Array.isArray(data['items'])) return [];

  const items = data['items'] as Record<string, unknown>[];

  return items
    .filter((item) => !item['resigned_on']) // Active officers only
    .map((item) => ({
      name: String(item['name'] ?? ''),
      role: String(item['officer_role'] ?? ''),
      appointedOn: String(item['appointed_on'] ?? ''),
      nationality: item['nationality'] ? String(item['nationality']) : undefined,
    }));
}
