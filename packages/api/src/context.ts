import type { Session } from "@memu/auth";
import type { Database } from "@memu/db";

export type Context = {
	session: Session | null;
	db: Database;
};
