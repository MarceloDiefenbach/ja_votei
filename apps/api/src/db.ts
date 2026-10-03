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
      option VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log("[db] schema ensured");
}
