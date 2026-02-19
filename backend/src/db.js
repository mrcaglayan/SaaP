import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const dbHost = process.env.DB_HOST || "localhost";
const dbPort = Number(process.env.DB_PORT || 3306);
const dbUser = process.env.DB_USER || "root";
const dbPassword = process.env.DB_PASSWORD || "1212";
const dbName = process.env.DB_NAME || "student";

function escapeIdentifier(name) {
  return String(name).replace(/`/g, "``");
}

export const pool = mysql.createPool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return { rows };
}

export async function queryWithConnection(connection, sql, params = []) {
  const [rows] = await connection.execute(sql, params);
  return { rows };
}

export async function withTransaction(work) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const tx = {
      query(sql, params = []) {
        return queryWithConnection(connection, sql, params);
      },
      connection,
    };

    const result = await work(tx);
    await connection.commit();
    return result;
  } catch (err) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failures and rethrow original error.
    }
    throw err;
  } finally {
    connection.release();
  }
}

export async function ensureDatabaseExists() {
  const connection = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
  });

  const safeDbName = escapeIdentifier(dbName);
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${safeDbName}\``);
  await connection.end();
}

export async function closePool() {
  await pool.end();
}
