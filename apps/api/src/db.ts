import mysql from "mysql2/promise";

export const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ja_votei",
  waitForConnections: true,
  connectionLimit: 10,
});

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      \`option\` VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Sessão anônima: cookie httpOnly assinado. É o que amarra o pagamento ao comprador.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id CHAR(64) PRIMARY KEY,
      credits INT NOT NULL DEFAULT 0,
      email VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Compra: uma linha por checkout. Idempotência via UNIQUE em bill_id.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchases (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id CHAR(64) NOT NULL,
      bill_id VARCHAR(64) NOT NULL,
      credits INT NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_bill (bill_id),
      KEY idx_session (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Eventos de webhook já processados — evita creditar duas vezes em retentativa.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id VARCHAR(128) PRIMARY KEY,
      event VARCHAR(64) NOT NULL,
      processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  console.log("[db] schema ensured");
}