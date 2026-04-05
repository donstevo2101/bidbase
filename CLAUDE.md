# CLAUDE.md — BidBase

> **Project:** BidBase — Multi-tenant Grant Bid Writing Platform
> **Version:** 1.2 — April 2026
> **Classification:** Internal build specification
> **Stack:** React + Node.js + Supabase
> **Agent:** Claude Code

The platform is named BidBase. Use this name consistently throughout all code, UI copy, emails, and documentation.

Read this file fully before writing a single line of code. When uncertain about
any decision — architecture, naming, schema, behaviour — re-read this file first.
This document is the single source of truth. It overrides verbal instructions.

---

## 1. What this platform is

A **multi-tenant SaaS product** for professional grant bid writing businesses.
Each business (the **operator**) runs their own fully isolated workspace with
their own clients, agents, documents, funders, pipeline, and branding.

The platform does four things:

1. **CRM** — full client lifecycle management: lead → onboarding → active
   engagement → offboarding. Client stage model (A, B, C), pipeline tracking,
   activity timeline, invoicing, and success fee management.

2. **Document management** — GDPR-compliant, per-client secure document storage.
   Clients upload governance documents, financials, policies, and evidence.
   The bid writer and AI agents access those documents to produce work.

3. **AI agent workflow** — a gated, sequential multi-agent system: eligibility
   checking, funder research, application drafting, operations management,
   social media content, social value reporting, funder intelligence, and
   client impact measurement. The platform enforces gates and approval
   checkpoints — no stage is skipped without the operator's explicit sign-off.

4. **SaaS billing and operator management** — self-serve signup, plan selection,
   Stripe billing, usage limits per plan, and an enterprise tier for larger
   bid writing businesses onboarded manually.

---

## 2. SaaS architecture — true multi-tenancy

Every operator is fully isolated. No operator ever sees another operator's
data, clients, documents, agents, or configuration. Isolation is enforced
at the **database level via Supabase RLS** — not at the application level.

```
BidBase SaaS
  │
  ├── Operator A (e.g. Time2Corner)
  │     ├── Operator users (bid writers, admins)
  │     ├── Clients (CICs, charities, social enterprises)
  │     │     ├── Client users (portal access)
  │     │     └── Client documents, applications, pipeline
  │     └── Org config (branding, plan, agent settings)
  │
  ├── Operator B (another bid writing business)
  │     └── [completely isolated — same structure]
  │
  └── Platform super admin
        └── All orgs, billing, platform config, support
```

### Isolation guarantee

- Every table has `organisation_id uuid NOT NULL`
- Every RLS policy enforces `organisation_id = (auth.jwt() ->> 'org_id')::uuid`
- The API middleware extracts `org_id` from the verified JWT and injects it
  into every query — no query runs without it
- No API endpoint ever accepts `organisation_id` as a user-supplied parameter
  — it always comes from the verified JWT

---

## 3. User roles and permissions

| Role | Who | Access |
|------|-----|--------|
| `super_admin` | Platform owners | All organisations, billing, platform config, support tools |
| `org_admin` | Bid writing business owner | All data within their org — clients, agents, docs, team, billing |
| `org_member` | Bid writing team member (writers, VAs) | Assigned clients and projects only |
| `client_admin` | Client's primary contact (e.g. CIC founder) | Their own workspace — upload docs, view progress, portal access |
| `client_member` | Additional client staff | Read-only access to their organisation's workspace |

Role is stored in `profiles.role`. Permissions enforced by Supabase RLS
on every table. The frontend renders based on what the API returns —
it never gates access by hiding UI elements alone.

---

## 4. Tech stack

### Frontend

| Concern | Technology |
|---------|-----------|
| Framework | **React 18** (Vite — not CRA, not Next.js) |
| Routing | **React Router v6** |
| Global state | **Zustand** — session, active org, active client |
| Server state | **TanStack Query** — all API calls, caching, background refresh |
| Forms | **React Hook Form + Zod** — validated on every form, no exceptions |
| UI components | **shadcn/ui** (Radix UI) + **Tailwind CSS** |
| File upload | **react-dropzone** + Supabase Storage signed URLs |
| Rich text editor | **Tiptap** — for application draft editing and review |
| Data tables | **TanStack Table** — sortable, filterable, paginated |
| Charts | **Recharts** — pipeline dashboards, conversion reporting |
| Notifications | **Sonner** — toast notifications |

### Backend

| Concern | Technology |
|---------|-----------|
| Runtime | **Node.js 20 LTS** |
| Framework | **Express.js** |
| Database client | **Supabase JS client** (server-side, service role key only) |
| Auth | **Supabase Auth** — JWT verification middleware on every route |
| Storage | **Supabase Storage** — private buckets, signed URL generation |
| AI agents | **Anthropic SDK** — `claude-sonnet-4-6` for all agents |
| Billing | **Stripe** — subscriptions, usage metering, webhooks |
| Email | **Resend** — transactional (invites, notifications, reminders) |
| Validation | **Zod** — schema validation on every request body |
| Background jobs | **Supabase Edge Functions** — scheduled tasks (Monday summary trigger, deadline alerts, success fee window checks) |

### Database

| Concern | Technology |
|---------|-----------|
| Database | **Supabase (PostgreSQL)** |
| Auth | **Supabase Auth** |
| Storage | **Supabase Storage** |
| Realtime | **Supabase Realtime** — agent streaming, live pipeline updates |
| RLS | Row Level Security enforced on **every single table** |

### Infrastructure

| Concern | Solution |
|---------|---------|
| Frontend | **Vercel** |
| Backend API | **Railway** |
| Database + storage | **Supabase Cloud — EU region (eu-west-2)** |
| Billing | **Stripe** |
| Email | **Resend** |
| Monitoring | **Vercel Analytics** + **Supabase logs** + **Sentry** (errors) |

### Absolute prohibitions — never do any of these

- Never use `localStorage` or `sessionStorage` for auth tokens or sensitive data
- Never use `any` in TypeScript — strict mode is on, keep it on
- Never use frontend permission checks as the sole access control
- Never use inline `style={{}}` — Tailwind classes only
- Never call the Anthropic API from the frontend — always via the Node.js API
- Never expose `SUPABASE_SERVICE_ROLE_KEY` or `ANTHROPIC_API_KEY` to the client
- Never serve documents via public URLs — always signed URLs, max 1-hour expiry
- Never write raw SQL — use the Supabase JS client query builder
- Never accept `organisation_id` as a user-supplied request parameter

---

## 5. Project structure

```
/
├── client/                           # React frontend (Vite)
│   └── src/
│       ├── app/                      # Root, providers, router setup
│       ├── pages/
│       │   ├── auth/                 # Login, register, verify, reset
│       │   ├── onboarding/           # New org setup wizard
│       │   ├── dashboard/            # Operator home — pipeline overview
│       │   ├── clients/              # CRM — list and detail
│       │   ├── pipeline/             # Kanban pipeline view
│       │   ├── documents/            # Document management
│       │   ├── agents/               # AI agent workspace
│       │   ├── applications/         # Grant applications list and detail
│       │   ├── funders/              # Funder database
│       │   ├── reports/              # Reporting and analytics
│       │   ├── settings/             # Org settings, team, billing, plan
│       │   ├── admin/                # Super admin panel (super_admin only)
│       │   └── portal/               # Client-facing portal (separate layout)
│       ├── components/
│       │   ├── ui/                   # shadcn/ui base components
│       │   ├── agents/               # Chat interface, gate panels, task cards
│       │   ├── crm/                  # Client cards, stage badges, timeline
│       │   ├── documents/            # Upload zone, file list, viewer
│       │   ├── pipeline/             # Kanban columns, client cards
│       │   ├── applications/         # Application cards, draft editor, gate flow
│       │   ├── billing/              # Plan selector, usage meter, upgrade prompts
│       │   └── layout/               # Shell, sidebar, topbar, breadcrumbs
│       ├── hooks/                    # Custom React hooks
│       ├── stores/                   # Zustand stores (session, org, ui)
│       ├── lib/
│       │   ├── supabase.ts           # Supabase browser client (anon key)
│       │   ├── api.ts                # Typed API client (wraps fetch + TanStack)
│       │   └── utils.ts
│       └── types/                    # Shared frontend TypeScript types
│
├── server/                           # Node.js + Express API
│   └── src/
│       ├── routes/
│       │   ├── auth.ts
│       │   ├── clients.ts
│       │   ├── documents.ts
│       │   ├── agents.ts
│       │   ├── applications.ts
│       │   ├── pipeline.ts
│       │   ├── funders.ts
│       │   ├── invoices.ts
│       │   ├── billing.ts            # Stripe endpoints
│       │   ├── storage.ts            # Signed URL generation
│       │   ├── admin.ts              # Super admin endpoints
│       │   └── webhooks/
│       │       ├── stripe.ts         # Stripe webhook handler
│       │       └── supabase.ts       # Supabase webhook handler
│       ├── middleware/
│       │   ├── auth.ts               # JWT validation, user + org context injection
│       │   ├── orgScope.ts           # Enforces org_id on every query
│       │   ├── planLimits.ts         # Checks plan limits before operations
│       │   └── validate.ts           # Zod request body validation
│       ├── agents/
│       │   ├── headCoach.ts
│       │   ├── vaAgent.ts
│       │   ├── eligibilityAgent.ts
│       │   ├── grantWriter.ts
│       │   ├── opsManager.ts
│       │   ├── socialMedia.ts
│       │   ├── socialValueAgent.ts       # New
│       │   ├── funderIntelligence.ts     # New
│       │   ├── impactMeasurement.ts      # New
│       │   ├── gateEnforcement.ts        # Gate 1/2/3 logic — server-side only
│       │   ├── contextBuilder.ts         # Assembles context pack per agent
│       │   └── prompts/                  # One file per agent — prompt functions
│       ├── billing/
│       │   ├── stripe.ts             # Stripe client, plan definitions
│       │   ├── plans.ts              # Plan features and limits
│       │   └── usage.ts              # Usage tracking and metering
│       └── lib/
│           ├── supabase.ts           # Supabase server client (service role)
│           ├── anthropic.ts          # Anthropic client + model constants
│           ├── resend.ts             # Email client + templates
│           └── storage.ts            # Storage helpers, signed URLs
│
├── supabase/
│   ├── migrations/                   # Ordered migration files
│   ├── seed.sql                      # Dev seed data
│   └── functions/                    # Edge functions (scheduled jobs)
│       ├── monday-summary/
│       ├── deadline-alerts/
│       └── success-fee-windows/
│
└── shared/
    └── types/                        # Types used by both client and server
        ├── api.ts                    # API response envelope types
        ├── database.ts               # Generated from Supabase schema
        └── agents.ts                 # Agent task and message types
```

---

## 6. Database schema

### Core tables

```sql
-- Organisations (one per bid writing business)
organisations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  slug                    text UNIQUE NOT NULL,     -- subdomain / white-label domain
  owner_id                uuid REFERENCES auth.users,
  plan                    text DEFAULT 'starter',   -- starter | professional | enterprise
  plan_started_at         timestamptz,
  trial_ends_at           timestamptz,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  onboarding_type         text DEFAULT 'self_serve', -- self_serve | manual
  onboarding_complete     boolean DEFAULT false,
  onboarding_state        jsonb DEFAULT '{}',       -- tracks setup wizard progress
  white_label_domain      text,                     -- enterprise custom domain
  branding                jsonb DEFAULT '{}',       -- logo, colours, name override
  settings                jsonb DEFAULT '{}',       -- feature flags, capacity overrides
  active                  boolean DEFAULT false,    -- false until email verified + plan selected
  suspended               boolean DEFAULT false,
  suspended_reason        text,
  created_at              timestamptz DEFAULT now()
)

-- User profiles (extends Supabase auth.users)
profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users,
  organisation_id uuid REFERENCES organisations,
  role            text NOT NULL,
  -- super_admin | org_admin | org_member | client_admin | client_member
  full_name       text,
  avatar_url      text,
  preferences     jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
)

-- Clients (CICs, charities, social enterprises)
clients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations,
  name                  text NOT NULL,
  type                  text,
  -- CIC | charity | social_enterprise | unincorporated | other
  stage                 text NOT NULL DEFAULT 'A',  -- A | B | C
  status                text NOT NULL DEFAULT 'lead',
  -- lead | active | paused | offboarded
  primary_contact_name  text,
  primary_contact_email text,
  primary_contact_phone text,
  annual_income         numeric,
  registered_number     text,
  address               jsonb,
  policies_held         text[],             -- list of policy types held
  existing_grants       jsonb DEFAULT '[]', -- {funder, amount, open_until}[]
  notes                 text,
  assigned_to           uuid REFERENCES profiles,
  portal_enabled        boolean DEFAULT false,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
)

-- Applications (grant applications)
applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations,
  client_id             uuid NOT NULL REFERENCES clients,
  funder_name           text NOT NULL,
  funder_id             uuid REFERENCES funders,
  project_name          text,
  project_description   text,
  amount_requested      numeric,
  deadline              timestamptz,
  status                text DEFAULT 'researching',
  -- researching | gate1_pending | gate1_failed | gate2_pending | gate2_high_risk
  -- | drafting | gate3_pending | draft_ready | awaiting_approval | submitted
  -- | successful | unsuccessful | withdrawn
  gate1_passed          boolean,
  gate1_report          jsonb,
  gate1_checked_at      timestamptz,
  gate2_passed          boolean,
  gate2_report          jsonb,
  gate2_risk_level      text,               -- pass | high_risk
  gate2_checked_at      timestamptz,
  gate3_passed          boolean,
  gate3_report          jsonb,
  gate3_checked_at      timestamptz,
  draft_content         jsonb,              -- {question: string, answer: string}[]
  budget_reconciliation jsonb,
  operator_approval     boolean DEFAULT false,
  operator_approved_by  uuid REFERENCES profiles,
  operator_approved_at  timestamptz,
  submitted_at          timestamptz,
  outcome               text,               -- successful | unsuccessful | pending
  outcome_amount        numeric,
  outcome_date          date,
  outcome_notes         text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
)

-- Funders
funders (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             uuid REFERENCES organisations, -- NULL = platform-wide shared
  name                        text NOT NULL,
  website                     text,
  grant_range_min             numeric,
  grant_range_max             numeric,
  eligible_structures         text[],
  eligible_geographies        text[],
  open_rounds                 jsonb DEFAULT '[]',
  -- [{name, opens, closes, priorities[], notes}]
  notes                       text,
  requires_preregistration    boolean DEFAULT false,
  preregistration_lead_weeks  integer,
  rejection_gap_months        integer,      -- months before reapplication allowed
  verified                    boolean DEFAULT false,  -- platform-verified funder data
  last_updated                timestamptz DEFAULT now(),
  created_at                  timestamptz DEFAULT now()
)

-- Documents
documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations,
  client_id       uuid NOT NULL REFERENCES clients,
  application_id  uuid REFERENCES applications,
  name            text NOT NULL,
  type            text NOT NULL,
  -- governance | financial | policy | evidence | questionnaire
  -- transcript | correspondence | draft | impact_data | other
  storage_path    text NOT NULL,
  storage_bucket  text NOT NULL,
  file_size       integer,
  mime_type       text,
  uploaded_by     uuid REFERENCES profiles,
  processing_status text DEFAULT 'pending',  -- pending | processed | failed
  extracted_text  text,                      -- text extracted for agent use
  notes           text,
  created_at      timestamptz DEFAULT now()
)

-- Agent conversations
agent_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations,
  client_id       uuid REFERENCES clients,
  application_id  uuid REFERENCES applications,
  agent_type      text NOT NULL,
  -- head_coach | va | eligibility | grant_writer | ops_manager | social_media
  -- | social_value | funder_intelligence | impact_measurement
  messages        jsonb NOT NULL DEFAULT '[]',
  -- [{role: user|assistant, content: string, timestamp}]
  context_pack    jsonb DEFAULT '{}',   -- assembled context at conversation start
  status          text DEFAULT 'active',
  created_by      uuid REFERENCES profiles,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
)

-- Agent tasks (discrete tasks assigned by Head Coach to sub-agents)
agent_tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations,
  conversation_id   uuid REFERENCES agent_conversations,
  client_id         uuid REFERENCES clients,
  application_id    uuid REFERENCES applications,
  assigned_to       text NOT NULL,            -- agent_type
  task_type         text NOT NULL,
  -- gate1_check | gate2_check | gate3_check | funder_shortlist
  -- | draft_application | monday_summary | create_content
  -- | onboarding_sequence | social_value_report | impact_report
  -- | funder_intelligence_update
  status            text DEFAULT 'pending',
  -- pending | in_progress | complete | failed | escalated | awaiting_approval
  brief             jsonb,
  output            jsonb,
  escalated_to      text,                     -- operator | head_coach
  escalation_reason text,
  created_at        timestamptz DEFAULT now(),
  started_at        timestamptz,
  completed_at      timestamptz
)

-- Activity log (full audit trail)
activity_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations,
  client_id       uuid REFERENCES clients,
  application_id  uuid REFERENCES applications,
  document_id     uuid REFERENCES documents,
  actor_id        uuid REFERENCES profiles,
  actor_type      text DEFAULT 'user',        -- user | agent | system
  action          text NOT NULL,
  details         jsonb,
  ip_address      inet,
  created_at      timestamptz DEFAULT now()
)

-- Invoices
invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations,
  client_id       uuid NOT NULL REFERENCES clients,
  amount          numeric NOT NULL,
  currency        text DEFAULT 'GBP',
  status          text DEFAULT 'pending',   -- pending | sent | paid | overdue | cancelled
  due_date        date,
  sent_at         timestamptz,
  paid_at         timestamptz,
  invoice_type    text,                     -- onboarding | monthly | success_fee | ad_hoc
  reference       text,
  notes           text,
  created_at      timestamptz DEFAULT now()
)

-- Success fee windows
success_fee_windows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations,
  client_id         uuid NOT NULL REFERENCES clients,
  application_id    uuid NOT NULL REFERENCES applications,
  offboarded_at     timestamptz NOT NULL,
  window_expires_at timestamptz NOT NULL,  -- offboarded_at + 60 days
  outcome           text DEFAULT 'pending', -- pending | awarded | expired
  award_amount      numeric,
  invoice_id        uuid REFERENCES invoices,
  alerted           boolean DEFAULT false,
  created_at        timestamptz DEFAULT now()
)

-- Platform plans (defines feature limits per plan)
plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,             -- starter | professional | enterprise
  stripe_price_id     text,
  monthly_price_gbp   numeric,
  max_active_clients  integer,                   -- NULL = unlimited
  max_stage_c_clients integer DEFAULT 4,
  max_team_members    integer,
  max_storage_gb      integer,
  agents_enabled      text[],                    -- which agents are available on this plan
  features            jsonb DEFAULT '{}',
  active              boolean DEFAULT true,
  created_at          timestamptz DEFAULT now()
)

-- Plan usage (metered per organisation)
plan_usage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations UNIQUE,
  active_clients  integer DEFAULT 0,
  stage_c_clients integer DEFAULT 0,
  team_members    integer DEFAULT 0,
  storage_used_gb numeric DEFAULT 0,
  agent_calls_month integer DEFAULT 0,
  updated_at      timestamptz DEFAULT now()
)
```

### Storage buckets (all private)

```
client-documents/
  {org_id}/{client_id}/governance/
  {org_id}/{client_id}/financials/
  {org_id}/{client_id}/policies/
  {org_id}/{client_id}/evidence/
  {org_id}/{client_id}/questionnaires/
  {org_id}/{client_id}/transcripts/
  {org_id}/{client_id}/impact-data/

application-drafts/
  {org_id}/{client_id}/{application_id}/

org-assets/
  {org_id}/logo/
  {org_id}/templates/
```

No public URLs anywhere. Files accessed via signed URLs only.
Maximum signed URL expiry: 1 hour. Every generation logged to `activity_log`.

---

## 7. AI agent system

### The nine agents

| Agent | Type | Purpose |
|-------|------|---------|
| **Head Coach** | Orchestrator | Receives operator instructions, assigns to sub-agents, reviews outputs, enforces gates, escalates |
| **VA** | Execution | Lead management, onboarding sequences, document chasing, scheduling, client admin |
| **Eligibility & Funder Research** | Execution | Gate 1 (eligibility), Gate 2 (match scoring), funder shortlists |
| **Grant Writer** | Execution | Application drafting with Gate 3 self-review before output |
| **Operations Manager** | Execution | Monday summary, deadline tracking, capacity, invoice alerts, success fee windows |
| **Social Media Manager** | Execution | Content drafts for operator's channels — drafts only, operator approves before posting |
| **Social Value Agent** | Execution | Social value reporting, HACT Social Value Bank calculations, TOMS framework outputs |
| **Funder Intelligence Agent** | Execution | Tracks new open rounds, deadline changes, funder priority shifts — alerts operator proactively |
| **Impact Measurement Agent** | Execution | Structures and reports client impact data — beneficiary numbers, outcomes, evidence base |

### Model — always this, never anything else

```typescript
// server/src/lib/anthropic.ts
export const AGENT_MODEL = "claude-sonnet-4-6";
export const AGENT_MAX_TOKENS = 4096;
```

### Architecture

All agent logic lives server-side in `server/src/agents/`. The frontend
never calls the Anthropic API directly.

```
Operator instruction
        │
        ▼
POST /api/agents/head-coach/message
        │
        ▼
Head Coach (headCoach.ts)
  Reads context from contextBuilder.ts
  Enforces gate logic via gateEnforcement.ts
        │
        ├─ Gate 1/2 check ──────────► Eligibility Agent
        ├─ Funder shortlist ────────► Eligibility Agent
        ├─ Draft application ───────► Grant Writer
        ├─ Admin task ──────────────► VA Agent
        ├─ Pipeline report ─────────► Ops Manager
        ├─ Content draft ───────────► Social Media Manager
        ├─ Social value report ─────► Social Value Agent
        ├─ Funder intelligence ─────► Funder Intelligence Agent
        └─ Impact report ───────────► Impact Measurement Agent
```

### Context builder

Before any agent runs, `contextBuilder.ts` assembles the context pack from
the database: client profile, current stage, documents (extracted text),
open applications, gate history, funder data. This context is passed as
part of the system prompt. Agents never query the database directly.

```typescript
// server/src/agents/contextBuilder.ts
export async function buildContext(
  orgId: string,
  clientId?: string,
  applicationId?: string
): Promise<AgentContext> {
  // Fetches client, documents (extracted_text only — not raw files),
  // applications, gate history, funder data
  // Returns typed AgentContext object
}
```

### Streaming — SSE

```typescript
// server/src/routes/agents.ts
router.post("/:agentType/message", authMiddleware, planLimitsMiddleware, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const context = await buildContext(
    req.user.org_id,
    req.body.clientId,
    req.body.applicationId
  );

  const systemPrompt = getSystemPrompt(req.params.agentType, context);

  const stream = anthropic.messages.stream({
    model: AGENT_MODEL,
    max_tokens: AGENT_MAX_TOKENS,
    system: systemPrompt,
    messages: req.body.messages,
  });

  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  await incrementAgentUsage(req.user.org_id);
  res.write("data: [DONE]\n\n");
  res.end();
});
```

### Gate enforcement — server-side, cannot be bypassed

```typescript
// server/src/agents/gateEnforcement.ts

export async function canBeginDrafting(applicationId: string, orgId: string) {
  const app = await getApplication(applicationId, orgId);

  if (!app.gate1_passed) {
    return { allowed: false, reason: "Gate 1 not cleared for this application." };
  }
  if (!app.gate2_passed) {
    return { allowed: false, reason: "Gate 2 not completed." };
  }
  if (app.gate2_risk_level === "high_risk" && !app.operator_approval) {
    return {
      allowed: false,
      reason: "Gate 2 flagged HIGH RISK. Operator approval required before drafting.",
    };
  }
  return { allowed: true };
}

export async function canSubmitApplication(applicationId: string, orgId: string) {
  const app = await getApplication(applicationId, orgId);

  if (!app.operator_approval) {
    return {
      allowed: false,
      reason: "Operator explicit approval required. This cannot be bypassed.",
    };
  }
  if (!app.gate3_passed) {
    return { allowed: false, reason: "Gate 3 quality review not completed." };
  }
  return { allowed: true };
}
```

### System prompts

System prompts live in `server/src/agents/prompts/`. Each file exports a
function receiving `AgentContext` and returning the full system prompt string.
They are loaded at runtime — never hardcoded inline.

The prompts for the six core agents are defined in the Time2Corner Agent
Build Cards (see companion document). The three new agent prompts are
defined in Section 8 below.

---

## 8. New agent specifications

### 8.1 Social Value Agent

**One-line role:** Structures and reports the social value created by a client's
funded project using recognised UK frameworks.

**Frameworks:**
- HACT Social Value Bank (UK housing and social sector standard)
- TOMS (Themes, Outcomes, Measures) framework
- Social Value Act 2012 reporting requirements
- SROI (Social Return on Investment) — simplified proxy values

**What it does:**
- Takes a client's project data (beneficiary numbers, activity types, outcomes)
  and maps them to HACT Social Value Bank proxy values
- Calculates indicative SROI ratio with clearly stated assumptions
- Produces a structured social value report suitable for funder reporting
- Drafts social value narrative sections for inclusion in grant applications
- Generates TOMS-compliant output for public sector procurement submissions

**What it never does:**
- Does not claim SROI figures as certified — always clearly labelled as indicative
- Does not invent beneficiary numbers — works only from data in the context pack
- Does not produce reports that overstate impact beyond what the evidence supports

**System prompt:**
```
You are the Social Value Agent for BidBase. Your job is to structure and
report social value created by community organisations using recognised UK frameworks.

FRAMEWORKS YOU APPLY:
HACT Social Value Bank — the primary tool for UK housing and social sector reporting.
TOMS (Themes, Outcomes, Measures) — for public sector procurement submissions.
Social Value Act 2012 — for commissioner reporting obligations.
SROI proxy values — indicative only, clearly labelled as such.

YOUR OUTPUTS:
For every report, produce: (1) a HACT proxy value calculation with stated assumptions,
(2) an SROI ratio clearly labelled as indicative, (3) a narrative social value summary
of 200-300 words suitable for funder reporting, (4) a TOMS-aligned output table if
required for the specific submission.

WHAT YOU NEVER DO:
You never invent beneficiary numbers or activity data. You never present indicative
SROI as certified. You never overstate impact beyond what the evidence in the context
pack supports. You always state your assumptions clearly.

TONE: Professional. Evidence-based. Clear about what is measured and what is estimated.
```

---

### 8.2 Funder Intelligence Agent

**One-line role:** Proactively monitors the UK grant funding landscape and alerts
the operator to new rounds, deadline changes, and priority shifts relevant to
their client base.

**What it does:**
- Searches for new open grant rounds matching the operator's client profiles
  (sector, geography, income band, structure type)
- Monitors funders already in the operator's database for round openings and closures
- Summarises new funder priorities and compares to previous rounds
- Produces a weekly intelligence briefing for the operator
- Flags funders requiring pre-registration with lead time warnings
- Identifies clients who newly qualify for funders they were previously ineligible for

**What it never does:**
- Does not contact funders directly
- Does not add funders to the database without operator confirmation
- Does not claim funding is guaranteed or likely — flags opportunities only

**System prompt:**
```
You are the Funder Intelligence Agent for BidBase. Your job is to keep the
operator ahead of the UK grant funding landscape for their client portfolio.

WEEKLY BRIEFING — produce every Monday alongside the Ops Manager summary:
New open rounds matching any active client's profile. Deadlines opening or
closing within 30 days. Changes to funder priorities since the last briefing.
Pre-registration deadlines requiring immediate action.

CLIENT MATCHING:
For each new opportunity, identify which clients in the operator's portfolio it
is most relevant to. Do not run full Gate 1 checks — flag for Eligibility Agent
review. Be specific about why the match is relevant.

SOURCES:
Search the web for current funder guidance, 360Giving data, NCVO funding updates,
DCMS announcements, Community Foundation round openings, National Lottery updates,
and sector-specific funders relevant to the client portfolio.

WHAT YOU NEVER DO:
You never contact funders. You never add funders to the database without operator
confirmation. You never claim an opportunity is likely to succeed — you flag
relevance only. You never present outdated deadline information without noting
that it requires verification.

TONE: Concise. Factual. Scannable. The operator reads this in under three minutes.
```

---

### 8.3 Impact Measurement Agent

**One-line role:** Helps operators and their clients structure, collect, and
report on project impact data in a format funders and commissioners expect.

**What it does:**
- Reviews a client's current impact data (from documents and questionnaire responses)
  and identifies gaps funders are likely to probe
- Suggests appropriate outcome indicators for the client's project type
- Drafts impact narrative sections for grant applications and reports
- Structures data for the Theory of Change: inputs, activities, outputs, outcomes, impact
- Produces a simple impact measurement framework for clients who do not have one
- Generates the impact section of the Monthly Progress Update

**What it never does:**
- Does not invent impact numbers — works only from supplied data
- Does not claim impact that the evidence does not support
- Does not produce academic-standard evaluation reports — flags when that level
  of rigour is required and recommends a specialist evaluator

**System prompt:**
```
You are the Impact Measurement Agent for BidBase. Your job is to help bid
writing businesses and their clients structure evidence of impact in the format
that funders and commissioners expect.

THEORY OF CHANGE STRUCTURE:
For every client project, frame impact across five levels:
Inputs (resources invested), Activities (what is delivered), Outputs (direct products
of activity — sessions, participants, resources), Outcomes (changes experienced by
beneficiaries), Impact (long-term or wider change attributable to the project).

EVIDENCE GAPS:
Review the client's existing evidence base and flag: which outcome claims lack data,
which beneficiary numbers are unverified, which funder criteria require specific
evidence types (e.g. pre/post surveys, case studies, third-party verification).

OUTPUT FORMATS:
Impact narrative (200-400 words for application sections), outcome indicator table,
Theory of Change diagram description (text-based — for the client to visualise),
data collection recommendations, monthly progress impact section.

WHAT YOU NEVER DO:
You never invent statistics. You never overstate outcomes beyond what the data
shows. You never produce academic-standard evaluation reports — when that level
is needed, flag it and recommend a specialist evaluator.

TONE: Clear. Structured. Accessible to a community organisation founder who is
not an evaluation specialist.
```

---

## 9. SaaS billing and plans

### Plan structure

| Feature | Starter | Professional | Enterprise |
|---------|---------|-------------|-----------|
| **Signup route** | Self-serve | Self-serve | Manual — BidBase onboarding |
| Active clients | 10 | 50 | Unlimited |
| Stage C clients | 4 | 4 | Configurable per org |
| Team members | 2 | 10 | Unlimited |
| Storage | 10 GB | 50 GB | Custom |
| Core agents (6) | Yes | Yes | Yes |
| Advanced agents (3) | No | Yes | Yes |
| Client portal | Basic | Full | Full + white-label |
| White-label domain | No | No | Yes |
| Custom branding | No | Limited | Full |
| Priority support | No | Email | Dedicated account manager |
| Onboarding call | No | No | Yes — live setup session |
| Custom capacity limits | No | No | Yes |
| Invoiced billing | No | No | Yes (optional) |

### Stripe integration

- All billing managed via Stripe Subscriptions
- Webhook handler at `POST /api/webhooks/stripe` processes:
  `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
  `customer.subscription.updated`, `customer.subscription.deleted`
- On payment failure: grace period of 7 days, then downgrade to read-only
- Plan limits enforced by `planLimitsMiddleware` before every operation
- Usage metered and stored in `plan_usage` table, refreshed daily

### Signup routes — two distinct paths

**Self-serve (Starter and Professional plans):**
1. Operator visits bidbase.io/signup — enters name, email, password
2. Verifies email via Supabase Auth magic link
3. Completes org setup wizard: business name, practice type, expected client volume
4. Selects Starter or Professional plan — Stripe Checkout opens in same tab
5. On successful payment, organisation activates and they land on the dashboard
6. Interactive walkthrough of Head Coach agent with a sample client pre-loaded
7. Stripe subscription created, `organisations.stripe_subscription_id` populated

**Enterprise (manual onboarding — BidBase team handles):**
1. Prospect submits enterprise enquiry form at bidbase.io/enterprise
2. BidBase team qualifies, agrees commercial terms offline
3. Super admin creates the organisation via `/api/admin/organisations` with
   `plan: 'enterprise'` and `onboarding_type: 'manual'`
4. Super admin sends personalised invite link to the operator's primary contact
5. Operator sets password and completes a streamlined setup wizard
   (no Stripe Checkout — invoiced separately or custom Stripe agreement)
6. BidBase team runs a live onboarding call, configures white-label settings
   and custom capacity overrides for this operator
7. Organisation marked `active: true` by super admin on completion

**Both paths share:**
- Email verification before any platform access
- DPA acceptance checkpoint during setup wizard (cannot be skipped)
- `organisations.settings` stores onboarding completion state — used to
  resume incomplete setups and trigger contextual tooltips post-onboarding

---

## 10. Core API endpoints

### Auth
```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/reset-password
GET    /api/auth/me
```

### Organisations
```
POST   /api/organisations                 # Create new org (signup)
GET    /api/organisations/me              # Current org detail
PATCH  /api/organisations/me              # Update org settings
GET    /api/organisations/me/usage        # Plan usage stats
```

### Clients
```
GET    /api/clients                       # List — paginated, filterable
POST   /api/clients                       # Create
GET    /api/clients/:id                   # Detail
PATCH  /api/clients/:id                   # Update
DELETE /api/clients/:id                   # Soft delete
GET    /api/clients/:id/timeline          # Activity log
GET    /api/clients/:id/documents         # Documents
GET    /api/clients/:id/applications      # Applications
GET    /api/clients/:id/invoices          # Invoices
```

### Applications
```
GET    /api/applications                  # List
POST   /api/applications                  # Create
GET    /api/applications/:id              # Detail
PATCH  /api/applications/:id              # Update
POST   /api/applications/:id/gate1        # Trigger Gate 1 check
POST   /api/applications/:id/gate2        # Trigger Gate 2 check
POST   /api/applications/:id/approve      # Operator approval (gate2 risk or submission)
POST   /api/applications/:id/submit       # Mark as submitted (operator only)
```

### Documents
```
GET    /api/documents                     # List
POST   /api/documents/upload              # Get signed upload URL
GET    /api/documents/:id                 # Metadata
GET    /api/documents/:id/url             # Signed download URL (1hr expiry)
DELETE /api/documents/:id                 # Delete
```

### Agents
```
POST   /api/agents/:agentType/message     # Send message — streams SSE
GET    /api/agents/conversations          # List
GET    /api/agents/conversations/:id      # Detail with messages
POST   /api/agents/tasks                  # Create task
GET    /api/agents/tasks/:id              # Task and output
```

### Pipeline
```
GET    /api/pipeline                      # Full pipeline by stage
GET    /api/pipeline/summary              # Monday summary data
GET    /api/pipeline/deadlines            # Upcoming deadlines
GET    /api/pipeline/capacity             # Stage C count and slots
GET    /api/pipeline/success-fees         # Live 60-day windows
```

### Funders
```
GET    /api/funders                       # List — search and filter
POST   /api/funders                       # Add to org funder database
PATCH  /api/funders/:id                   # Update
GET    /api/funders/search                # Eligibility-filtered search
```

### Billing
```
POST   /api/billing/create-checkout       # Create Stripe Checkout session
POST   /api/billing/create-portal         # Create Stripe Customer Portal session
GET    /api/billing/subscription          # Current subscription status
POST   /api/webhooks/stripe               # Stripe webhook handler
```

### Super admin
```
GET    /api/admin/organisations                   # All orgs — filterable by plan/status
POST   /api/admin/organisations                   # Create org (enterprise onboarding)
GET    /api/admin/organisations/:id               # Org detail
PATCH  /api/admin/organisations/:id               # Update (plan, suspend, capacity override)
POST   /api/admin/organisations/:id/invite        # Send enterprise invite link
POST   /api/admin/organisations/:id/activate      # Activate org after manual onboarding
GET    /api/admin/metrics                         # Platform-wide metrics
GET    /api/admin/metrics/revenue                 # MRR, ARR, churn
GET    /api/admin/metrics/usage                   # Agent calls, storage, active orgs
```

---

## 11. GDPR — non-negotiable requirements

- **EU data residency** — Supabase project must be in eu-west-2 or equivalent.
  Document in deployment config. Never deploy to a non-EU region.
- **Private storage only** — no document ever accessible via a public URL
- **Signed URLs** — max 1-hour expiry, server-side only, every generation logged
- **Extracted text only to agents** — documents are processed server-side to extract
  text. Only `extracted_text` is passed to the Anthropic API — never raw file bytes
- **Access logging** — every document view and download logged with `user_id`,
  `timestamp`, `document_id`, `ip_address` to `activity_log`
- **Right to erasure** — `DELETE /api/clients/:id` cascades soft-delete across all
  related records. Hard delete by `org_admin` only with explicit confirmation
- **DPA at onboarding** — operator must accept a Data Processing Agreement before
  their organisation is activated. Stored in `organisations.settings`
- **Breach notification** — audit log is exportable. Documented process for 72-hour
  ICO notification in platform runbook
- **Data minimisation** — no field is collected without a documented purpose

---

## 12. Build phases

### Phase 1 — Foundation
1. Supabase project — schema, RLS policies, storage buckets, edge functions scaffold
2. Auth — register, login, email verify, password reset, JWT middleware
3. Org creation — setup wizard, plan selection placeholder (no Stripe yet)
4. CRM — create clients, assign stages, list and detail views
5. Document upload — Supabase Storage, signed URLs, text extraction
6. Head Coach agent — streaming chat, basic context

### Phase 2 — Core workflow
7. Application management — create, status tracking, gate status display
8. Gate 1 and Gate 2 — eligibility agent, enforcement middleware
9. Grant Writer agent — context pack, draft generation, Gate 3
10. Approval workflow — operator approval endpoints and UI
11. Operations Manager — Monday summary, deadline alerts, capacity tracking

### Phase 3 — Full agent suite
12. VA Agent — onboarding sequences, reminder scheduling
13. Social Media Manager — content draft workflow
14. Social Value Agent — HACT calculations, SROI, TOMS output
15. Funder Intelligence Agent — weekly briefing, client matching
16. Impact Measurement Agent — Theory of Change, evidence gaps
17. Funder database — search, platform-wide funders, org-specific funders

### Phase 4 — SaaS layer
18. Stripe integration — Checkout sessions, webhooks, subscription management
19. Self-serve billing UI — plan selector, Stripe Checkout flow, Stripe Customer Portal
20. Plan limits middleware — enforce client count, storage, agent access per plan
21. Client portal — client login, document upload, progress view
22. Invoicing — create, track, overdue alerts, success fee windows
23. Reporting — pipeline health, conversion rates, revenue per client

### Phase 5 — Enterprise and scale
24. Enterprise signup flow — enquiry form, super admin manual creation, invite link
25. Enterprise onboarding — live setup wizard variant, capacity config, DPA
26. White-label — custom domains (DNS CNAME config), branding overrides per org
27. Super admin panel — org management, manual activation, plan overrides, metrics
28. Multi-tenancy audit — full RLS review, cross-org isolation penetration test
29. Performance — query optimisation, connection pooling, rate limiting
30. Monitoring — Sentry error tracking, uptime alerts, Supabase slow query review

---

## 13. Environment variables

```bash
# .env — never commit. Listed in .gitignore.

# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=                # Frontend only
SUPABASE_SERVICE_ROLE_KEY=        # Backend only — never expose to client

# Anthropic
ANTHROPIC_API_KEY=                # Backend only — never expose to client

# Stripe
STRIPE_SECRET_KEY=                # Backend only
STRIPE_WEBHOOK_SECRET=            # Webhook signature verification
STRIPE_STARTER_PRICE_ID=
STRIPE_PROFESSIONAL_PRICE_ID=
STRIPE_ENTERPRISE_PRICE_ID=

# Resend
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# App
NODE_ENV=development
PORT=3001
CLIENT_URL=http://localhost:5173

# Storage
STORAGE_BUCKET_DOCUMENTS=client-documents
STORAGE_BUCKET_DRAFTS=application-drafts
STORAGE_BUCKET_ASSETS=org-assets
```

---

## 14. Code standards

### TypeScript
- Strict mode on in every `tsconfig.json` — never disable it
- No `any` — use `unknown` and narrow, or define the type explicitly
- All database types generated from Supabase schema: `supabase gen types typescript`
- All API response types in `shared/types/api.ts`

### API responses
```typescript
// Success
{ success: true, data: T }

// Error
{ success: false, error: { code: string, message: string } }

// Paginated
{ success: true, data: T[], pagination: { page: number, limit: number, total: number } }
```

### Error handling
- All Express routes wrapped in `asyncHandler` — no unhandled rejections
- Errors logged server-side with context: `user_id`, `org_id`, `route`, `timestamp`
- Client receives code and message only — never stack traces in production
- HTTP status codes: 401 unauthenticated, 403 unauthorised, 404 not found,
  422 validation failure, 429 rate limited, 500 server error

### Git
- `main` — production only, no direct commits, requires PR
- `develop` — integration branch
- Feature branches: `feature/`, `fix/`, `chore/`, `docs/`
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- Every PR requires description of what changed and why

### Testing
- Unit tests required for all gate enforcement logic (non-negotiable)
- Integration tests required for all API endpoints
- No test, no merge for anything touching agents, gates, or approvals

---

## 15. Hard constraints — absolute, non-negotiable, enforced in code

```
CONSTRAINT 1:  No application is submitted without operator explicit written approval.
               canSubmitApplication() returns false if operator_approval is false.
               Enforced in the API — frontend cannot bypass.

CONSTRAINT 2:  No drafting begins until gate1_passed AND gate2_passed are true
               in the database. Gate 2 HIGH RISK requires operator_approval on record.
               canBeginDrafting() enforced on every draft request server-side.

CONSTRAINT 3:  No agent assigns or changes client stages.
               Stage is changed only by PATCH /api/clients/:id from org_admin or org_member.

CONSTRAINT 4:  Complaints route to the operator immediately.
               No agent handles, responds to, or resolves complaints.

CONSTRAINT 5:  Anthropic API key never reaches the frontend.
               All agent calls via POST /api/agents/:agentType/message.

CONSTRAINT 6:  No document served via a public URL.
               Signed URLs only, server-side generation, max 1-hour expiry.

CONSTRAINT 7:  Stage C client count respects the plan limit.
               planLimitsMiddleware enforces this before confirming any new Stage C client.

CONSTRAINT 8:  Grant Writer requires a complete context pack.
               If any required item is missing, it returns a structured needs list —
               never a partial draft.

CONSTRAINT 9:  Every query is scoped to org_id from the verified JWT.
               No cross-organisation data leakage is possible.

CONSTRAINT 10: Supabase RLS is the authoritative access control layer.
               Frontend permission checks are UI polish only.

CONSTRAINT 11: Only extracted_text is passed to agents — never raw file bytes.
               Documents are processed server-side before any agent sees them.

CONSTRAINT 12: Stripe webhook signature is verified on every webhook request.
               Never process a billing event without signature verification.
```

---

*BidBase — Build Specification v1.2*
*April 2026 | Confidential | Internal use only*
