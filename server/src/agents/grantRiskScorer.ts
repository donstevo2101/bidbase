/**
 * Grant Risk Scorer for BidBase.
 * Evaluates the likelihood of a client successfully winning a specific grant.
 * Uses rule-based scoring with optional AI enhancement via Claude.
 */

import { anthropic, AGENT_MODEL, AGENT_MAX_TOKENS } from '../lib/anthropic.js';
import type { GrantOpportunity } from './grantScraper.js';

// ---- Types ----

export interface RiskFactor {
  factor: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: number; // 0-100
  detail: string;
}

export interface RiskScoreResult {
  score: number;
  reasoning: string;
  factors: RiskFactor[];
}

// ---- Main export ----

/**
 * Scores how likely a client is to succeed with a specific grant opportunity.
 * Returns a score 0-100, reasoning, and individual factor assessments.
 */
export async function scoreGrantRisk(
  grant: GrantOpportunity,
  clientType: string,
  clientSectors?: string[],
  clientGeography?: string,
  clientIncome?: number
): Promise<RiskScoreResult> {
  // Always compute rule-based score as baseline
  const factors = computeRuleBasedFactors(grant, clientType, clientSectors, clientGeography, clientIncome);
  const ruleScore = computeWeightedScore(factors);

  // If Anthropic is available, get AI-enhanced assessment
  if (anthropic) {
    try {
      const aiResult = await getAiRiskAssessment(grant, clientType, clientSectors, clientGeography, clientIncome, factors);
      return aiResult;
    } catch (err) {
      console.error('[RiskScorer] AI assessment failed, falling back to rules:', err instanceof Error ? err.message : err);
    }
  }

  // Fall back to rule-based scoring
  const reasoning = buildRuleBasedReasoning(ruleScore, factors);
  return { score: ruleScore, reasoning, factors };
}

// ---- Rule-based scoring ----

function computeRuleBasedFactors(
  grant: GrantOpportunity,
  clientType: string,
  clientSectors?: string[],
  clientGeography?: string,
  clientIncome?: number
): RiskFactor[] {
  const factors: RiskFactor[] = [];

  // 1. Type match (30% weight)
  factors.push(evaluateTypeMatch(grant, clientType));

  // 2. Sector alignment (25% weight)
  factors.push(evaluateSectorAlignment(grant, clientSectors));

  // 3. Geography match (15% weight)
  factors.push(evaluateGeographyMatch(grant, clientGeography));

  // 4. Income bracket (10% weight)
  factors.push(evaluateIncomeBracket(grant, clientIncome));

  // 5. Competition level (10% weight)
  factors.push(evaluateCompetition(grant));

  // 6. Historical success (10% weight)
  factors.push(evaluateHistoricalSuccess(grant));

  return factors;
}

function evaluateTypeMatch(grant: GrantOpportunity, clientType: string): RiskFactor {
  const eligText = (grant.eligibility ?? '' + ' ' + (grant.description ?? '')).toLowerCase();
  const typeTerms: Record<string, string[]> = {
    CIC: ['cic', 'community interest company', 'social enterprise', 'community organisation'],
    charity: ['charity', 'charitable', 'registered charity', 'voluntary organisation'],
    social_enterprise: ['social enterprise', 'cic', 'community interest', 'not-for-profit'],
    unincorporated: ['community group', 'unincorporated', 'voluntary group', 'informal group'],
  };

  const terms = typeTerms[clientType] ?? [clientType.toLowerCase()];
  const matches = terms.filter((t) => eligText.includes(t));

  if (matches.length > 0) {
    return {
      factor: 'Type match',
      impact: 'positive',
      weight: 30,
      detail: `Client type "${clientType}" matches grant eligibility criteria (${matches.join(', ')})`,
    };
  }

  // Check for explicit exclusions
  const exclusions = ['local authority only', 'statutory bodies', 'nhs', 'government department'];
  const excluded = exclusions.some((e) => eligText.includes(e));
  if (excluded) {
    return {
      factor: 'Type match',
      impact: 'negative',
      weight: 30,
      detail: `Grant appears restricted to statutory bodies — "${clientType}" may not be eligible`,
    };
  }

  return {
    factor: 'Type match',
    impact: 'neutral',
    weight: 30,
    detail: `Unable to determine type match from available grant information`,
  };
}

function evaluateSectorAlignment(grant: GrantOpportunity, clientSectors?: string[]): RiskFactor {
  if (!clientSectors || clientSectors.length === 0) {
    return {
      factor: 'Sector alignment',
      impact: 'neutral',
      weight: 25,
      detail: 'No client sectors provided for matching',
    };
  }

  const grantSectors = grant.sectors ?? [];
  const grantText = ((grant.description ?? '') + ' ' + (grant.eligibility ?? '')).toLowerCase();

  const matchingSectors = clientSectors.filter(
    (cs) => grantSectors.some((gs) => gs.toLowerCase().includes(cs.toLowerCase()) || cs.toLowerCase().includes(gs.toLowerCase())) ||
            grantText.includes(cs.toLowerCase())
  );

  if (matchingSectors.length >= 2) {
    return {
      factor: 'Sector alignment',
      impact: 'positive',
      weight: 25,
      detail: `Strong sector alignment: ${matchingSectors.join(', ')}`,
    };
  }

  if (matchingSectors.length === 1) {
    return {
      factor: 'Sector alignment',
      impact: 'positive',
      weight: 25,
      detail: `Partial sector alignment: ${matchingSectors[0]}`,
    };
  }

  if (grantSectors.length === 0) {
    return {
      factor: 'Sector alignment',
      impact: 'neutral',
      weight: 25,
      detail: 'Grant sector focus unclear — may be open to all sectors',
    };
  }

  return {
    factor: 'Sector alignment',
    impact: 'negative',
    weight: 25,
    detail: `Client sectors (${clientSectors.join(', ')}) do not overlap with grant focus (${grantSectors.join(', ')})`,
  };
}

function evaluateGeographyMatch(grant: GrantOpportunity, clientGeography?: string): RiskFactor {
  if (!clientGeography) {
    return {
      factor: 'Geography match',
      impact: 'neutral',
      weight: 15,
      detail: 'No client geography provided for matching',
    };
  }

  const grantText = ((grant.description ?? '') + ' ' + (grant.eligibility ?? '') + ' ' + grant.title).toLowerCase();
  const geoLower = clientGeography.toLowerCase();

  // Check for UK-wide grants
  if (grantText.includes('uk-wide') || grantText.includes('national') || grantText.includes('england-wide')) {
    return {
      factor: 'Geography match',
      impact: 'positive',
      weight: 15,
      detail: 'Grant is available nationally',
    };
  }

  // Check if client geography is mentioned
  if (grantText.includes(geoLower)) {
    return {
      factor: 'Geography match',
      impact: 'positive',
      weight: 15,
      detail: `Grant covers client geography: ${clientGeography}`,
    };
  }

  // Check regional terms
  const regions: Record<string, string[]> = {
    'north west': ['manchester', 'liverpool', 'lancashire', 'cumbria', 'cheshire', 'merseyside'],
    'north east': ['newcastle', 'sunderland', 'durham', 'northumberland', 'tyne', 'tees'],
    'west midlands': ['birmingham', 'coventry', 'wolverhampton', 'staffordshire', 'warwickshire'],
    'east midlands': ['nottingham', 'leicester', 'derby', 'northampton', 'lincoln'],
    'south west': ['bristol', 'devon', 'cornwall', 'somerset', 'dorset', 'gloucester'],
    'south east': ['kent', 'surrey', 'sussex', 'hampshire', 'berkshire', 'oxfordshire', 'buckinghamshire'],
    'london': ['london', 'greater london'],
    'yorkshire': ['leeds', 'sheffield', 'bradford', 'hull', 'york'],
    'east of england': ['norfolk', 'suffolk', 'essex', 'cambridge', 'hertfordshire', 'bedfordshire'],
    'wales': ['wales', 'cymru', 'cardiff', 'swansea'],
    'scotland': ['scotland', 'edinburgh', 'glasgow'],
    'northern ireland': ['northern ireland', 'belfast'],
  };

  for (const [region, terms] of Object.entries(regions)) {
    if (geoLower.includes(region) || terms.some((t) => geoLower.includes(t))) {
      if (grantText.includes(region) || terms.some((t) => grantText.includes(t))) {
        return {
          factor: 'Geography match',
          impact: 'positive',
          weight: 15,
          detail: `Grant covers ${region} region`,
        };
      }
    }
  }

  return {
    factor: 'Geography match',
    impact: 'neutral',
    weight: 15,
    detail: 'Unable to determine geographic eligibility from available information',
  };
}

function evaluateIncomeBracket(grant: GrantOpportunity, clientIncome?: number): RiskFactor {
  if (!clientIncome) {
    return {
      factor: 'Income bracket',
      impact: 'neutral',
      weight: 10,
      detail: 'No client income data provided',
    };
  }

  const grantText = ((grant.description ?? '') + ' ' + (grant.eligibility ?? '')).toLowerCase();

  // Check for income thresholds
  const incomeMatch = grantText.match(/(?:income|turnover|revenue)\s*(?:under|below|less than|up to)\s*[£]?([\d,]+)/i);
  if (incomeMatch) {
    const threshold = parseInt(incomeMatch[1].replace(/,/g, ''), 10);
    if (clientIncome <= threshold) {
      return {
        factor: 'Income bracket',
        impact: 'positive',
        weight: 10,
        detail: `Client income (£${clientIncome.toLocaleString()}) is within the grant threshold (£${threshold.toLocaleString()})`,
      };
    }
    return {
      factor: 'Income bracket',
      impact: 'negative',
      weight: 10,
      detail: `Client income (£${clientIncome.toLocaleString()}) exceeds grant threshold (£${threshold.toLocaleString()})`,
    };
  }

  // Check for "small organisation" indicators
  if (grantText.includes('small') || grantText.includes('grassroots') || grantText.includes('micro')) {
    if (clientIncome < 100000) {
      return {
        factor: 'Income bracket',
        impact: 'positive',
        weight: 10,
        detail: 'Grant targets small/grassroots organisations — client income aligns',
      };
    }
    if (clientIncome > 1000000) {
      return {
        factor: 'Income bracket',
        impact: 'negative',
        weight: 10,
        detail: 'Grant targets small organisations — client income may be too high',
      };
    }
  }

  return {
    factor: 'Income bracket',
    impact: 'neutral',
    weight: 10,
    detail: 'No income criteria identified in grant information',
  };
}

function evaluateCompetition(grant: GrantOpportunity): RiskFactor {
  if (grant.previousAwards && grant.totalApplicants) {
    const successRate = (grant.previousAwards / grant.totalApplicants) * 100;

    if (successRate >= 50) {
      return {
        factor: 'Competition level',
        impact: 'positive',
        weight: 10,
        detail: `High success rate: ${successRate.toFixed(0)}% of applicants awarded (${grant.previousAwards} of ${grant.totalApplicants})`,
      };
    }
    if (successRate >= 20) {
      return {
        factor: 'Competition level',
        impact: 'neutral',
        weight: 10,
        detail: `Moderate competition: ${successRate.toFixed(0)}% success rate (${grant.previousAwards} of ${grant.totalApplicants})`,
      };
    }
    return {
      factor: 'Competition level',
      impact: 'negative',
      weight: 10,
      detail: `High competition: only ${successRate.toFixed(0)}% success rate (${grant.previousAwards} of ${grant.totalApplicants})`,
    };
  }

  if (grant.previousAwards) {
    return {
      factor: 'Competition level',
      impact: 'neutral',
      weight: 10,
      detail: `${grant.previousAwards} previous awards made — applicant volume unknown`,
    };
  }

  return {
    factor: 'Competition level',
    impact: 'neutral',
    weight: 10,
    detail: 'No competition data available for this grant',
  };
}

function evaluateHistoricalSuccess(grant: GrantOpportunity): RiskFactor {
  // Without a database lookup of past awards to similar orgs, we use proxy signals
  const grantText = ((grant.description ?? '') + ' ' + (grant.eligibility ?? '')).toLowerCase();

  if (grantText.includes('previously funded') || grantText.includes('repeat application') || grantText.includes('returning applicant')) {
    return {
      factor: 'Historical success',
      impact: 'neutral',
      weight: 10,
      detail: 'Funder appears to welcome repeat applicants',
    };
  }

  if (grantText.includes('new applicants') || grantText.includes('first-time') || grantText.includes('not previously funded')) {
    return {
      factor: 'Historical success',
      impact: 'positive',
      weight: 10,
      detail: 'Funder prioritises new applicants — favourable for first approach',
    };
  }

  return {
    factor: 'Historical success',
    impact: 'neutral',
    weight: 10,
    detail: 'No historical funding pattern data available',
  };
}

function computeWeightedScore(factors: RiskFactor[]): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const factor of factors) {
    totalWeight += factor.weight;
    let factorScore: number;
    switch (factor.impact) {
      case 'positive':
        factorScore = 80;
        break;
      case 'negative':
        factorScore = 20;
        break;
      case 'neutral':
      default:
        factorScore = 50;
        break;
    }
    weightedSum += factorScore * factor.weight;
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
}

function buildRuleBasedReasoning(score: number, factors: RiskFactor[]): string {
  const positives = factors.filter((f) => f.impact === 'positive');
  const negatives = factors.filter((f) => f.impact === 'negative');

  let reasoning = '';

  if (score >= 80) {
    reasoning = 'Strong match — high likelihood of success. ';
  } else if (score >= 60) {
    reasoning = 'Good match — moderate competition expected. ';
  } else if (score >= 40) {
    reasoning = 'Partial match — some criteria gaps identified. ';
  } else if (score >= 20) {
    reasoning = 'Weak match — significant barriers to success. ';
  } else {
    reasoning = 'Poor match — unlikely to succeed with this grant. ';
  }

  if (positives.length > 0) {
    reasoning += `Strengths: ${positives.map((f) => f.detail).join('; ')}. `;
  }
  if (negatives.length > 0) {
    reasoning += `Concerns: ${negatives.map((f) => f.detail).join('; ')}.`;
  }

  return reasoning.trim();
}

// ---- AI-enhanced scoring ----

async function getAiRiskAssessment(
  grant: GrantOpportunity,
  clientType: string,
  clientSectors?: string[],
  clientGeography?: string,
  clientIncome?: number,
  ruleFactors?: RiskFactor[]
): Promise<RiskScoreResult> {
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  const prompt = `You are a UK grant funding expert. Score how likely this client would succeed with this grant opportunity.

GRANT DETAILS:
- Title: ${grant.title}
- Funder: ${grant.funder}
- Amount: ${grant.amount ?? 'Not specified'}
- Description: ${grant.description ?? 'Not available'}
- Eligibility: ${grant.eligibility ?? 'Not specified'}
- Sectors: ${grant.sectors?.join(', ') ?? 'Not specified'}
- Previous Awards: ${grant.previousAwards ?? 'Unknown'}
- Total Applicants: ${grant.totalApplicants ?? 'Unknown'}
- Status: ${grant.status ?? 'Unknown'}

CLIENT PROFILE:
- Type: ${clientType}
- Sectors: ${clientSectors?.join(', ') ?? 'Not specified'}
- Geography: ${clientGeography ?? 'Not specified'}
- Annual Income: ${clientIncome ? `£${clientIncome.toLocaleString()}` : 'Not specified'}

RULE-BASED ASSESSMENT (for reference):
${ruleFactors?.map((f) => `- ${f.factor}: ${f.impact} (${f.detail})`).join('\n') ?? 'None computed'}

Score 0-100 where:
- 80-100: Strong match, high likelihood
- 60-79: Good match, moderate competition
- 40-59: Partial match, specific criteria gaps
- 20-39: Weak match, significant barriers
- 0-19: Poor match, unlikely to succeed

Respond in EXACTLY this JSON format, nothing else:
{
  "score": <number 0-100>,
  "reasoning": "<2-3 sentence assessment>",
  "factors": [
    {"factor": "Type match", "impact": "positive|negative|neutral", "weight": 30, "detail": "<explanation>"},
    {"factor": "Sector alignment", "impact": "positive|negative|neutral", "weight": 25, "detail": "<explanation>"},
    {"factor": "Geography match", "impact": "positive|negative|neutral", "weight": 15, "detail": "<explanation>"},
    {"factor": "Income bracket", "impact": "positive|negative|neutral", "weight": 10, "detail": "<explanation>"},
    {"factor": "Competition level", "impact": "positive|negative|neutral", "weight": 10, "detail": "<explanation>"},
    {"factor": "Historical success", "impact": "positive|negative|neutral", "weight": 10, "detail": "<explanation>"}
  ]
}`;

  const response = await anthropic.messages.create({
    model: AGENT_MODEL,
    max_tokens: AGENT_MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI response did not contain valid JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    score: number;
    reasoning: string;
    factors: RiskFactor[];
  };

  // Validate score is in range
  const score = Math.max(0, Math.min(100, Math.round(parsed.score)));

  return {
    score,
    reasoning: parsed.reasoning,
    factors: parsed.factors,
  };
}
