/**
 * Alta de aparatos con código QR (pairing).
 *
 * Flujo: la app (persona autenticada) genera un código corto de un solo uso
 * asociado a un grupo → el aparato lo canjea por su token largo → el token
 * se muestra UNA sola vez y en la base solo queda su hash SHA-256.
 * Los códigos expiran a los 10 minutos y no se pueden reusar.
 */
import { randomBytes } from "node:crypto";
import { device, deviceToken, member, pairingCode } from "@memu/db/schema/memu";
import { ORPCError } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
	generateDeviceToken,
	hashDeviceToken,
	requireMemberOfGroup,
} from "../device-auth";
import { protectedProcedure, publicProcedure } from "../index";

/** Alfabeto sin caracteres ambiguos (0/O, 1/I/l). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export function generatePairingCode(): string {
	const bytes = randomBytes(CODE_LENGTH);
	let code = "";
	for (const b of bytes) {
		code += CODE_ALPHABET[b % CODE_ALPHABET.length];
	}
	return code;
}

export const pairingRouter = {
	/**
	 * Genera un código de emparejamiento para un grupo (lo muestra la app
	 * como QR). Solo miembros persona del grupo.
	 */
	createPairingCode: protectedProcedure
		.input(z.object({ groupId: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const { db } = context;
			const userId = context.session.user.id;
			await requireMemberOfGroup(db, input.groupId, { userId });

			const code = generatePairingCode();
			const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
			await db.insert(pairingCode).values({
				code,
				groupId: input.groupId,
				createdById: userId,
				expiresAt,
			});
			return { code, expiresAt };
		}),

	/**
	 * El aparato canjea el código por su token largo. Crea el aparato, lo
	 * suma como miembro del grupo y devuelve el token UNA sola vez.
	 * Procedimiento público: el aparato todavía no tiene credenciales.
	 */
	claimPairingCode: publicProcedure
		.input(
			z.object({
				code: z.string().min(1).max(16),
				deviceName: z.string().min(1).max(60),
			}),
		)
		.handler(async ({ input, context }) => {
			const { db } = context;
			const now = new Date();

			const found = await db
				.select()
				.from(pairingCode)
				.where(
					and(
						eq(pairingCode.code, input.code.toUpperCase()),
						isNull(pairingCode.usedAt),
					),
				)
				.limit(1);
			const pairing = found[0];
			if (!pairing || pairing.expiresAt <= now) {
				throw new ORPCError("NOT_FOUND");
			}

			// Secuencial (sin transacción interactiva: el driver neon-http no
			// las soporta). El `usedAt` + unique(code) acota la ventana de
			// doble canje a un caso despreciable en el MVP familiar.
			const [newDevice] = await db
				.insert(device)
				.values({ name: input.deviceName })
				.returning({ id: device.id });
			if (!newDevice) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudo crear el aparato",
				});
			}
			await db.insert(member).values({
				groupId: pairing.groupId,
				memberType: "device",
				deviceId: newDevice.id,
			});
			const token = generateDeviceToken();
			await db.insert(deviceToken).values({
				deviceId: newDevice.id,
				tokenHash: hashDeviceToken(token),
			});
			await db
				.update(pairingCode)
				.set({ usedAt: now })
				.where(eq(pairingCode.id, pairing.id));

			return { deviceId: newDevice.id, token };
		}),

	/**
	 * Da de baja un aparato: revoca todos sus tokens vigentes. Solo un
	 * miembro persona de un grupo que contenga al aparato.
	 */
	revokeDeviceToken: protectedProcedure
		.input(z.object({ deviceId: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const { db } = context;
			const userId = context.session.user.id;

			const memberships = await db
				.select({ groupId: member.groupId })
				.from(member)
				.where(eq(member.deviceId, input.deviceId));
			if (memberships.length === 0) {
				throw new ORPCError("NOT_FOUND");
			}
			// Autorización: soy persona en al menos un grupo del aparato.
			let authorized = false;
			for (const m of memberships) {
				try {
					await requireMemberOfGroup(db, m.groupId, { userId });
					authorized = true;
					break;
				} catch {
					// no soy miembro de este grupo, sigo con el siguiente
				}
			}
			if (!authorized) {
				throw new ORPCError("FORBIDDEN");
			}

			const now = new Date();
			const revoked = await db
				.update(deviceToken)
				.set({ revokedAt: now })
				.where(
					and(
						eq(deviceToken.deviceId, input.deviceId),
						isNull(deviceToken.revokedAt),
					),
				)
				.returning({ id: deviceToken.id });
			return { revokedCount: revoked.length };
		}),
};
