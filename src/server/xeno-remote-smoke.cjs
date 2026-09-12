const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE is_active = true LIMIT 1');
    if (!rows[0]) throw new Error('No active user available for smoke token');
    const token = jwt.sign({ userId: rows[0].id }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const response = await fetch('http://127.0.0.1:8080/api/xeno/remote/status', {
      headers: { authorization: 'Bearer ' + token },
    });
    const body = await response.json().catch(() => ({}));
    console.log(JSON.stringify({ status: response.status, body }, null, 2));
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
