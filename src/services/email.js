// Email service — replaces src/services/email.js
// Uses MailChannels (free on Workers) instead of nodemailer

export async function sendReportEmail(env, { to, subject, text, csvContent, csvFilename }) {
  if (!env.SMTP_HOST && !env.MAILCHANNELS_ENABLED) {
    throw new Error(
      'Email is not configured. Set MAILCHANNELS_ENABLED=1 in your wrangler secrets or vars.'
    );
  }

  const fromName = env.EMAIL_FROM_NAME || 'Beam Stock Management';
  const fromEmail = env.SMTP_USER || 'noreply@beamstock.workers.dev';

  const base64Csv = btoa(csvContent);

  const send_request = new Request('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: fromName },
      subject: subject,
      content: [{ type: 'text/plain', value: text }],
      attachments: [
        {
          filename: csvFilename,
          content: base64Csv,
          type: 'text/csv',
          disposition: 'attachment',
        },
      ],
    }),
  });

  const response = await fetch(send_request);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MailChannels error: ${response.status} ${errText}`);
  }
}
