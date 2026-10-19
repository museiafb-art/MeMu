/**
 * Helpers de tests: base de datos Postgres en memoria (pg-mem) con el
 * esquema real aplicado desde las migraciones de drizzle-kit.
 *
 * Se usa `drizzle-orm/pg-proxy` con el Pool de `pg-mem` (`createPg`), que
 * maneja parámetros $1 correctamente. No se mezcla con el driver real `pg`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "@memu/db";
import { drizzle } from "drizzle-orm/pg-proxy";
import { newDb } from "pg-mem";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "..", "db", "src", "migrations");

/** Toma un valor opcional en tests: falla el test si es undefined. */
export function must<T>(value: T | undefined, label = "valor"): T {
	if (value === undefined) throw new Error(`se esperaba ${label}`);
	return value;
}

/** Crea una DB fresca con todas las migraciones aplicadas. */
export function createTestDb(): Database {
	const mem = newDb({ autoCreateForeignKeyIndices: true });

	const dirs = readdirSync(MIGRATIONS_DIR)
		.filter((d) => /^\d/.test(d))
		.sort();
	for (const dir of dirs) {
		const sql = readFileSync(
			join(MIGRATIONS_DIR, dir, "migration.sql"),
			"utf8",
		);
		for (const raw of sql.split("--> statement-breakpoint")) {
			const stmt = raw.trim();
			if (stmt) {
				mem.public.none(stmt);
			}
		}
	}

	const pg = mem.adapters.createPg();
	const pool = new pg.Pool();
	const db = drizzle(async (sql, params, _method) => {
		const result = await pool.query(sql, params);
		// drizzle-orm v1 mapea las filas por posición (row[i]), no por nombre:
		// pg-mem ordena las claves del objeto según el SELECT, así que
		// Object.values preserva el orden de columnas.
		const rows = result.rows.map((row: Record<string, unknown>) =>
			Object.values(row),
		);
		return { rows };
	});
	return db as unknown as Database;
}
