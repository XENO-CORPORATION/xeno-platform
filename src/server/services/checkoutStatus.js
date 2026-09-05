/** Read-only checkout reconciliation. Only signed webhooks can fulfill a sale. */
export async function readCheckoutStatus(pool, stripe, userId, sessionId) {
  const notFound = () => Object.assign(new Error('Checkout not found'), { status: 404 });
  if (!/^cs_[a-zA-Z0-9_]{1,240}$/.test(sessionId || '')) throw notFound();
  // Authorize locally BEFORE contacting Stripe. A session ID is not a credential.
  const binding = await pool.query(
    'SELECT item_id FROM checkout_consents WHERE user_id = $1 AND checkout_session_id = $2 AND consumed_at IS NOT NULL LIMIT 1',
    [String(userId), sessionId],
  );
  if (!binding.rows.length) throw notFound();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {}, { timeout: 10000, maxNetworkRetries: 1 });
  if (session.id !== sessionId || session.metadata?.xenoUserId !== String(userId) || session.metadata?.itemId !== binding.rows[0].item_id) throw notFound();
  const settled = ['paid', 'no_payment_required'].includes(session.payment_status);
  let fulfilled = false;
  if (settled && session.mode === 'payment') {
    const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    const result = await pool.query(
      `SELECT 1 FROM billing_events WHERE event_id = $1 AND user_id = $2
       UNION ALL SELECT 1 FROM billing_charges WHERE payment_intent = $3 AND user_id = $2 LIMIT 1`,
      [`checkout:${sessionId}`, String(userId), paymentIntent || null],
    );
    fulfilled = result.rows.length > 0;
  } else if (settled && session.mode === 'subscription') {
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (subId) {
      const workspaceId = session.metadata?.xenoWorkspaceId;
      const result = workspaceId
        ? await pool.query("SELECT 1 FROM workspaces WHERE id = $1 AND metadata->'billing'->>'stripe_subscription_id' = $2", [workspaceId, subId])
        : await pool.query('SELECT 1 FROM xeno_account_plans WHERE user_id = $1 AND stripe_subscription_id = $2', [String(userId), subId]);
      fulfilled = result.rows.length > 0;
    }
  }
  return { state: session.status === 'expired' ? 'expired' : fulfilled ? 'fulfilled' : settled ? 'fulfilling' : session.status === 'complete' ? 'processing' : 'open' };
}
