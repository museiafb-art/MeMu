import type { Context as ApiContext } from "@memu/api/context";
import { resolveDeviceAuth } from "@memu/api/device-auth";
import type { NextRequest } from "next/server";
import { auth, db } from "./services";

export async function createContext(req: NextRequest): Promise<ApiContext> {
	const session = await auth.api.getSession({
		headers: req.headers,
	});
	// El aparato se autentica con `Authorization: Bearer <device-token>`.
	// null si no hay header, es inválido o el token está revocado.
	const device = await resolveDeviceAuth(db, req.headers.get("authorization"));
	return {
		db,
		session,
		device,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
