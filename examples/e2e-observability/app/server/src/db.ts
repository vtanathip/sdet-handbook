import { Pool } from 'pg';

// pg reads PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD from the environment.
// All five are set as Machine-level env vars by the Pulumi userdata script.
// Use SSL when explicitly opted-in (EC2/RDS) but not for local Docker Postgres.
const sslConfig = process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT ?? '5432', 10),
  database: process.env.PGDATABASE ?? 'todos',
  user: process.env.PGUSER ?? 'todos',
  password: process.env.PGPASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: sslConfig,
});

export default pool;
