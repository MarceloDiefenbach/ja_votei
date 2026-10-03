import { pool } from "./db";

/**
 * Imagens geradas ficam guardadas por 48 horas, presas à sessão de quem pagou.
 * É a garantia de que ninguém perde o que pagou se a tela recarregar ou a conexão cair.
 */

export const IMAGE_TTL_HOURS = 48;

export async function saveImage(sessionId: string, candidate: string, b64: string): Promise<number> {
  // Limpeza oportunista: sem cron, quem grava também varre o que já venceu.
  await pool.query("DELETE FROM generated_images WHERE expires_at < NOW()");
  const [res]: any = await pool.query(
    "INSERT INTO generated_images (session_id, candidate, image, expires_at) " +
      "VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))",
    [sessionId, candidate, Buffer.from(b64, "base64"), IMAGE_TTL_HOURS],
  );
  return res.insertId as number;
}

/** Metadados (sem o binário, que é pesado). Mais nova primeiro. */
export async function listImages(sessionId: string) {
  const [rows]: any = await pool.query(
    "SELECT id, candidate, TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS seconds_left " +
      "FROM generated_images WHERE session_id = ? AND expires_at > NOW() ORDER BY id DESC LIMIT 100",
    [sessionId],
  );
  return rows.map((r: any) => ({ id: r.id, candidate: r.candidate, secondsLeft: Number(r.seconds_left) }));
}

/** Só devolve se a imagem for da sessão e ainda estiver dentro do prazo. */
export async function getImage(sessionId: string, id: number): Promise<Buffer | null> {
  const [rows]: any = await pool.query(
    "SELECT image FROM generated_images WHERE id = ? AND session_id = ? AND expires_at > NOW()",
    [id, sessionId],
  );
  return rows[0]?.image ?? null;
}
