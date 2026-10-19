import type { Session } from "@memu/auth";
import type { Database } from "@memu/db";

import type { DeviceIdentity } from "./device-auth";

export type Context = {
	session: Session | null;
	/** Identidad del aparato si el request trae un Bearer token válido. */
	device: DeviceIdentity | null;
	db: Database;
};
