import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "LetsWearIt <notifications@letswearit.app>"; // needs a verified domain in Resend

function recipientFor(store) {
  return store.ownerEmail || store.manualNotifyEmail;
}

export async function sendUsageWarningEmail(store) {
  const to = recipientFor(store);
  if (!to) return;

  await resend.emails.send({
    from: FROM,
    to,
    subject: "You're close to your AI try-on limit",
    html: `
      <p>Hi,</p>
      <p>Your store <strong>${store.shop}</strong> has used
      ${store.generationsUsed} of ${store.generationLimit} try-on generations
      for this billing period.</p>
      <p>Once you hit the limit, new try-ons will pause until your plan renews
      or you upgrade.</p>
      <p><a href="https://${store.shop}/admin/apps">Review your plan</a></p>
    `,
  });
}

export async function sendLimitReachedEmail(store) {
  const to = recipientFor(store);
  if (!to) return;

  await resend.emails.send({
    from: FROM,
    to,
    subject: "You've reached your AI try-on limit",
    html: `
      <p>Hi,</p>
      <p>Your store <strong>${store.shop}</strong> has used all
      ${store.generationLimit} try-on generations for this billing period.
      New try-on requests are paused until you upgrade or the period renews.</p>
      <p><a href="https://${store.shop}/admin/apps">Upgrade your plan</a></p>
    `,
  });
}

export async function sendTrialEndingEmail(store) {
  const to = recipientFor(store);
  if (!to) return;

  await resend.emails.send({
    from: FROM,
    to,
    subject: "Your free trial ends soon",
    html: `
      <p>Hi,</p>
      <p>Your 5-day free trial for <strong>${store.shop}</strong> ends on
      ${store.trialEndsAt?.toDateString()}. Pick a plan to keep the AI
      try-on widget live on your store.</p>
    `,
  });
}
