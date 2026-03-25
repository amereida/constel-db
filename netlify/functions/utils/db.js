import postgres from "postgres";

let sql;

export function getDb() {
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}
