import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { sendEmail } from '../lib/resend.js';
import { validate } from '../middleware/validate.js';
import type { Request, Response, NextFunction } from 'express';

export const enterpriseRouter = Router();

// ---- Helpers ----

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// ---- Schemas ----

const enquirySchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  company: z.string().min(1).max(255),
  phone: z.string().max(50).optional(),
  expectedClients: z.number().int().positive().optional(),
  message: z.string().max(5000).optional(),
});

// ---- Routes ----

/**
 * POST /enquiry
 * Enterprise enquiry form submission. Public — no auth required.
 */
enterpriseRouter.post(
  '/enquiry',
  validate(enquirySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, email, company, phone, expectedClients, message } = req.body;

    // Store the enquiry
    const { data, error } = await supabase
      .from('enterprise_enquiries')
      .insert({
        name,
        email,
        company,
        phone: phone ?? null,
        expected_clients: expectedClients ?? null,
        message: message ?? null,
        status: 'new',
      })
      .select()
      .single();

    if (error) {
      console.error('[Enterprise] Failed to store enquiry:', error.message);
      res.status(500).json({
        success: false,
        error: { code: 'ENQUIRY_FAILED', message: 'Failed to submit enquiry' },
      });
      return;
    }

    // Notify admin via email
    await sendEmail({
      to: process.env['ADMIN_EMAIL'] ?? 'admin@bidbase.io',
      subject: `New Enterprise Enquiry from ${company}`,
      html: `
        <h2>New Enterprise Enquiry</h2>
        <table style="border-collapse:collapse;width:100%;max-width:500px;">
          <tr><td style="padding:6px 12px;font-weight:bold;">Name</td><td style="padding:6px 12px;">${name}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Email</td><td style="padding:6px 12px;">${email}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;">Company</td><td style="padding:6px 12px;">${company}</td></tr>
          ${phone ? `<tr><td style="padding:6px 12px;font-weight:bold;">Phone</td><td style="padding:6px 12px;">${phone}</td></tr>` : ''}
          ${expectedClients ? `<tr><td style="padding:6px 12px;font-weight:bold;">Expected Clients</td><td style="padding:6px 12px;">${expectedClients}</td></tr>` : ''}
          ${message ? `<tr><td style="padding:6px 12px;font-weight:bold;">Message</td><td style="padding:6px 12px;">${message}</td></tr>` : ''}
        </table>
      `,
    });

    // Send confirmation to the enquirer
    await sendEmail({
      to: email,
      subject: 'Thanks for your interest in BidBase Enterprise',
      html: `
        <h2>Thanks for your interest, ${name}!</h2>
        <p>We've received your enterprise enquiry for <strong>${company}</strong>.</p>
        <p>A member of our team will be in touch within 1 business day to discuss your requirements.</p>
        <p>— The BidBase Team</p>
      `,
    });

    res.status(201).json({
      success: true,
      data: { id: data.id, submitted: true },
    });
  }),
);
