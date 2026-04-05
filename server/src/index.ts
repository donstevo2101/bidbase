import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { organisationsRouter } from './routes/organisations.js';
import { clientsRouter } from './routes/clients.js';
import { documentsRouter } from './routes/documents.js';
import { applicationsRouter } from './routes/applications.js';
import { agentsRouter } from './routes/agents.js';
import { pipelineRouter } from './routes/pipeline.js';
import { fundersRouter } from './routes/funders.js';
import { billingRouter } from './routes/billing.js';
import { stripeWebhookRouter } from './routes/webhooks/stripe.js';
import { invoicesRouter } from './routes/invoices.js';
import { adminRouter } from './routes/admin.js';
import { enterpriseRouter } from './routes/enterprise.js';
import { reportsRouter } from './routes/reports.js';
import { schedulerRouter } from './routes/scheduler.js';
import { clientParserRouter } from './routes/clientParser.js';

const app = express();
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const CLIENT_URL = process.env['CLIENT_URL'] ?? 'http://localhost:5173';

// Global middleware
app.use(cors({ origin: CLIENT_URL, credentials: true }));

// Stripe webhook needs raw body — mount BEFORE json middleware
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);

app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'bidbase-api' });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/organisations', organisationsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/funders', fundersRouter);
app.use('/api/billing', billingRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/enterprise', enterpriseRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/scheduler', schedulerRouter);
app.use('/api/client-parser', clientParserRouter);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[Error] ${err.message}`, {
    stack: process.env['NODE_ENV'] === 'development' ? err.stack : undefined,
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env['NODE_ENV'] === 'development'
        ? err.message
        : 'An unexpected error occurred',
    },
  });
});

app.listen(PORT, () => {
  console.log(`BidBase API running on port ${PORT}`);
});

export default app;
