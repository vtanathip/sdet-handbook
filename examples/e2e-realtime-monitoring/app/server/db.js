const { Pool } = require('pg');

// pg reads PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD from the environment.
// All five are set as Machine-level env vars by the Pulumi userdata script so
// no .env file is needed on the EC2 instance.
const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.PGDATABASE || 'todos',
  user: process.env.PGUSER || 'todos',
  password: process.env.PGPASSWORD,
  // Keep the pool lean for a single-instance perf-test environment
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

module.exports = pool;
