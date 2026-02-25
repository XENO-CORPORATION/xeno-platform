/**
 * Credit transaction helpers using PostgreSQL.
 * All operations use row-level locking to prevent race conditions.
 */

export async function deductCredits(db, userId, amount) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT credits FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'User not found' };
    }

    const currentCredits = rows[0].credits;

    if (currentCredits < amount) {
      await client.query('ROLLBACK');
      return { success: false, currentCredits };
    }

    const { rows: updated } = await client.query(
      'UPDATE users SET credits = credits - $1 WHERE id = $2 RETURNING credits',
      [amount, userId]
    );

    await client.query('COMMIT');
    return { success: true, newBalance: updated[0].credits };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function refundCredits(db, userId, amount) {
  const { rows } = await db.query(
    'UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING credits',
    [amount, userId]
  );
  return { success: true, newBalance: rows[0]?.credits ?? null };
}

export async function logUsage(db, userId, feature, amount, metadata = {}) {
  await db.query(
    `INSERT INTO credit_usage (user_id, feature, credits_used, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [userId, feature, amount, JSON.stringify(metadata || {})]
  );
}
