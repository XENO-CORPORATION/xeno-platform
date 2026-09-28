// Scope caps reuse canonical ledger holds/debits. No scope balance is stored.
export async function lockFundingScopes(db,projectId,workspaceId) {
  // Namespace ordering is fixed, never UUID dependent: workspace before project.
  if(workspaceId)await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`funding-scope:workspace:${workspaceId}`]);
  if(projectId)await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`funding-scope:project:${projectId}`]);
}
export async function assertScopeFundingCaps(db,projectId,workspaceId,amount) {
  const caps=(await db.query(`SELECT * FROM workforce_scope_spend_caps WHERE state='approved'
    AND ((scope_kind='project' AND scope_id=$1) OR (scope_kind='workspace' AND scope_id=$2))
    ORDER BY scope_kind,scope_id,window_seconds`,[projectId,workspaceId])).rows;
  for(const cap of caps) {
    const total=(await db.query(`WITH payers AS (
      SELECT p.account_owner_id AS id FROM workforce_funding_pools p
      JOIN workforce_funding_campaigns c ON c.id=p.campaign_id JOIN chat_projects project ON project.id=c.project_id
      WHERE ($1='project' AND project.id=$2) OR ($1='workspace' AND project.workspace_id=$2)
    ) SELECT
      (SELECT COALESCE(sum(h.amount_micro-h.settled_micro),0) FROM credit_holds h JOIN payers p ON p.id=h.user_id WHERE h.state='held')
      +(SELECT COALESCE(sum(-t.amount),0) FROM credit_transactions t JOIN payers p ON p.id=t.user_id
        WHERE t.type='debit' AND t.created_at>(clock_timestamp() AT TIME ZONE 'UTC')-make_interval(secs=>$3)) AS total`,
      [cap.scope_kind,cap.scope_id,cap.window_seconds])).rows[0].total;
    if(BigInt(total)+amount>BigInt(cap.limit_micro))throw Object.assign(new Error('funding_scope_limit'),
      {code:'needs_approval',details:{schemaVersion:1,reason:'funding_scope_limit'}});
  }
}
