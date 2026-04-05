import { Resend } from 'resend';

const apiKey = process.env['RESEND_API_KEY'];
const fromEmail = process.env['RESEND_FROM_EMAIL'] ?? 'noreply@bidbase.io';

if (!apiKey) {
  console.warn('RESEND_API_KEY not set — email sending disabled');
}

export const resend = apiKey ? new Resend(apiKey) : null;

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!resend) {
    console.warn(`[Email skipped] To: ${params.to}, Subject: ${params.subject}`);
    return;
  }

  await resend.emails.send({
    from: fromEmail,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}
