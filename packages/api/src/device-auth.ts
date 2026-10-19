/**
 * Autenticación de aparatos (ESP32) para la API.
 *
 * Cada aparato tiene un token largo propio (guardado en su NVS). En la base
 * solo vive el HASH SHA-256, nunca el token en claro (spec 05). El token
 * viaja como `Authorization: Bearer <token>` y se resuelve en `createContext`
 * (apps/web). Los procedimientos de aparato usan `deviceProcedure`, que
 * además aplica rate limit (checklist permanente: 60 req/min por token).
 */
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@memu/db";
import { deviceToken, member } from "@memu/db/schema/memu";
import { ORPCError } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "./context";
import { o, publicProcedure } from "./index";

export type DeviceIdentity = {
	tokenId: string;
	deviceId: string;
};

/** SHA-256 en hex del token. Lo único que se persiste. */
export function hashDeviceToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Genera un token largo (256 bits) para un aparato. Se muestra UNA sola vez. */
export function generateDeviceToken(): string {
	return randomBytes(32).toString("hex");
}

/**
 * Resuelve el header `Authorization: Bearer <token>` a la identidad del
 * aparato, o null si falta / es inválido / está revocado.
 */
export async function resolveDeviceAuth(
	db: Database,
	authHeader: string | null | undefined,
): Promise<DeviceIdentity | null> {
	if (!authHeader) return null;
	const match = /^Bearer (.+)$/.exec(authHeader.trim());
	const raw = match?.[1];
	if (!raw) return null;
	const tokenHash = hashDeviceToken(raw);
	const rows = await db
		.select({ id: deviceToken.id, deviceId: deviceToken.deviceId })
		.from(deviceToken)
		.where(
			and(eq(deviceToken.tokenHash, tokenHash), isNull(deviceToken.revokedAt)),
		)
		.limit(1);
	if (rows.length === 0) return null;
	const row = rows[0];
	if (!row) return null;
	return { tokenId: row.id, deviceId: row.deviceId };
}

export type RateLimiter = {
	/** Devuelve true si el request pasa, false si excede el límite. */
	consume: (key: string) => boolean;
	reset: () => void;
};

export function createRateLimiter(options: {
	limit: number;
	windowMs: number;
}): RateLimiter {
	const { limit, windowMs } = options;
	const hits = new Map<string, { count: number; windowStart: number }>();
	return {
		consume(key: string) {
			const now = Date.now();
			const entry = hits.get(key);
			if (!entry || now - entry.windowStart >= windowMs) {
				hits.set(key, { count: 1, windowStart: now });
				return true;
			}
			if (entry.count >= limit) return false;
			entry.count += 1;
			return true;
		},
		reset() {
			hits.clear();
		},
	};
}

/**
 * 60 req/min por token en endpoints de aparato (checklist permanente).
 * Nota: el contador vive en memoria por instancia; en serverless es una
 * primera barrera, no un límite distribuido.
 */
export const deviceRateLimiter = createRateLimiter({
	limit: 60,
	windowMs: 60_000,
});

/**
 * Procedimiento para aparatos: exige token válido + respeta el rate limit.
 * El `rateLimiter` es inyectable para tests.
 */
export function buildDeviceProcedure(rateLimiter: RateLimiter) {
	return publicProcedure.use(
		o.middleware(async ({ context, next }) => {
			const device = context.device;
			if (!device) {
				throw new ORPCError("UNAUTHORIZED");
			}
			if (!rateLimiter.consume(device.tokenId)) {
				throw new ORPCError("TOO_MANY_REQUESTS");
			}
			return next({ context: { device } });
		}),
	);
}

export const deviceProcedure = buildDeviceProcedure(deviceRateLimiter);

/**
 * Procedimiento para "persona autenticada O aparato con token válido".
 * Lo usan los endpoints que ambos pueden llamar (ej. subir/registrar audios).
 */
export const authedProcedure = publicProcedure.use(
	o.middleware(async ({ context, next }) => {
		if (!context.session?.user && !context.device) {
			throw new ORPCError("UNAUTHORIZED");
		}
		return next({
			context: { session: context.session, device: context.device },
		});
	}),
);

export type Caller = { userId: string } | { deviceId: string };

/** Extrae quién llama (persona o aparato) desde el contexto ya autenticado. */
export function callerFromContext(
	context: Pick<Context, "session" | "device">,
): Caller {
	if (context.session?.user) return { userId: context.session.user.id };
	if (context.device) return { deviceId: context.device.deviceId };
	throw new ORPCError("UNAUTHORIZED");
}

/**
 * Exige que quien llama sea miembro del grupo (persona o aparato).
 * Aislamiento por groupId SIN excepciones (checklist permanente).
 */
export async function requireMemberOfGroup(
	db: Database,
	groupId: string,
	caller: Caller,
) {
	const rows = await db
		.select()
		.from(member)
		.where(
			and(
				eq(member.groupId, groupId),
				"userId" in caller
					? eq(member.userId, caller.userId)
					: eq(member.deviceId, caller.deviceId),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("FORBIDDEN");
	}
	return row;
}
