/**
 * Mensajes de voz: subida, registro, listado y recibos de escucha.
 *
 * Todos los procedimientos exigen autenticación (persona con sesión o
 * aparato con token válido) y aislamiento por groupId SIN excepciones
 * (checklist permanente): nadie ve ni toca mensajes de otro grupo.
 */
import { randomUUID } from "node:crypto";
import { user } from "@memu/db/schema/auth";
import {
	group,
	listenReceipt,
	member,
	voiceMessage,
} from "@memu/db/schema/memu";
import {
	ALLOWED_AUDIO_MIME_TYPES,
	MAX_AUDIO_BYTES,
	PRESIGNED_URL_TTL_SECONDS,
	requireStorageClient,
} from "@memu/storage";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";

import {
	authedProcedure,
	callerFromContext,
	requireMemberOfGroup,
} from "../device-auth";
import { protectedProcedure } from "../index";
import { services } from "../services";
import { runTranscodeWithRetry } from "../transcode";

const EXT_BY_MIME: Record<string, string> = {
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/vnd.wave": "wav",
	"audio/mp4": "m4a",
	"audio/aac": "aac",
	"audio/mpeg": "mp3",
	"audio/ogg": "ogg",
	"audio/webm": "webm",
};

/** Promesa que nunca rechaza hacia el caller: loguea y sigue. */
function fireAndForget(promise: Promise<unknown>, label: string): void {
	promise.catch((err) => console.error(`[voice] ${label} falló`, err));
}

export const voiceRouter = {
	/**
	 * Pide una URL prefirmada para subir un audio al grupo.
	 * La clave queda fijada por el servidor: `audio/<groupId>/<uuid>.<ext>`.
	 */
	requestUploadUrl: authedProcedure
		.input(
			z.object({
				groupId: z.string().min(1),
				contentType: z.string().min(1),
				contentLength: z.number().int().positive(),
			}),
		)
		.handler(async ({ input, context }) => {
			const caller = callerFromContext(context);
			await requireMemberOfGroup(context.db, input.groupId, caller);

			if (
				!ALLOWED_AUDIO_MIME_TYPES.includes(
					input.contentType as (typeof ALLOWED_AUDIO_MIME_TYPES)[number],
				)
			) {
				throw new Error(`Tipo de audio no permitido: ${input.contentType}`);
			}
			if (input.contentLength > MAX_AUDIO_BYTES) {
				throw new Error(
					`Audio demasiado grande: máximo ${MAX_AUDIO_BYTES} bytes`,
				);
			}

			const ext = EXT_BY_MIME[input.contentType] ?? "bin";
			const storageKey = `audio/${input.groupId}/${randomUUID()}.${ext}`;
			const storage = requireStorageClient(services.storage);
			const uploadUrl = await storage.getPresignedPutUrl(
				storageKey,
				input.contentType,
			);
			return {
				uploadUrl,
				storageKey,
				expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
			};
		}),

	/**
	 * Registra un audio ya subido como mensaje del grupo. Dispara (sin
	 * bloquear la respuesta): aviso MQTT, push a los demás miembros y
	 * transcodificación si el original es WAV.
	 */
	registerVoiceMessage: authedProcedure
		.input(
			z.object({
				groupId: z.string().min(1),
				storageKey: z.string().min(1),
				durationSeconds: z.number().int().min(1).max(600),
			}),
		)
		.handler(async ({ input, context }) => {
			const { db } = context;
			const caller = callerFromContext(context);
			const membership = await requireMemberOfGroup(db, input.groupId, caller);

			// La clave debe pertenecer al prefijo del grupo (la fija el servidor).
			if (!input.storageKey.startsWith(`audio/${input.groupId}/`)) {
				throw new Error("La clave del audio no pertenece al grupo");
			}

			const inserted = await db
				.insert(voiceMessage)
				.values({
					groupId: input.groupId,
					senderMemberId: membership.id,
					storageKey: input.storageKey,
					durationSeconds: input.durationSeconds,
				})
				.returning({ id: voiceMessage.id });
			const first = inserted[0];
			if (!first) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudo registrar el mensaje",
				});
			}
			const messageId = first.id;

			// Aviso MQTT al grupo (dormido → no-op con log).
			if (services.mqtt) {
				fireAndForget(
					services.mqtt.publishGroupNotification({
						groupId: input.groupId,
						messageId,
					}),
					"mqtt",
				);
			} else {
				console.log("[voice] MQTT dormido: aviso no publicado");
			}

			// Push (solo metadatos) a los demás miembros con token registrado.
			const groupRow = await db
				.select({ name: group.name })
				.from(group)
				.where(eq(group.id, input.groupId))
				.limit(1);
			const groupName = groupRow[0]?.name ?? "tu grupo";
			if (services.push) {
				const conditions = [
					eq(member.groupId, input.groupId),
					isNotNull(user.pushToken),
				];
				if ("userId" in caller) {
					// No me notifico a mí mismo.
					conditions.push(ne(user.id, caller.userId));
				}
				const recipients = await db
					.select({ pushToken: user.pushToken })
					.from(member)
					.innerJoin(user, eq(member.userId, user.id))
					.where(and(...conditions));
				const tokens = recipients
					.map((r) => r.pushToken)
					.filter((t): t is string => !!t);
				if (tokens.length > 0) {
					fireAndForget(
						services.push.sendPush(tokens, {
							title: "MeMu",
							body: `Tenés un mensaje nuevo en ${groupName}`,
						}),
						"push",
					);
				}
			}

			// Transcodificación del WAV (fire-and-forget con reintentos acotados).
			if (services.storage && input.storageKey.toLowerCase().endsWith(".wav")) {
				void runTranscodeWithRetry(
					{ storage: services.storage, db },
					{ messageId, groupId: input.groupId, storageKey: input.storageKey },
				);
			}

			return { id: messageId };
		}),

	/**
	 * Mensajes del grupo ordenados por fecha, con marca de "escuchado por mí".
	 */
	listMessages: authedProcedure
		.input(
			z.object({
				groupId: z.string().min(1),
				limit: z.number().int().min(1).max(100).default(50),
			}),
		)
		.handler(async ({ input, context }) => {
			const { db } = context;
			const caller = callerFromContext(context);
			const membership = await requireMemberOfGroup(db, input.groupId, caller);

			const messages = await db
				.select()
				.from(voiceMessage)
				.where(eq(voiceMessage.groupId, input.groupId))
				.orderBy(asc(voiceMessage.createdAt))
				.limit(input.limit);

			const receipts = await db
				.select({ messageId: listenReceipt.messageId })
				.from(listenReceipt)
				.where(eq(listenReceipt.memberId, membership.id));
			const listened = new Set(receipts.map((r) => r.messageId));

			return messages.map((m) => ({
				id: m.id,
				groupId: m.groupId,
				durationSeconds: m.durationSeconds,
				createdAt: m.createdAt,
				listenedByMe: listened.has(m.id),
			}));
		}),

	/**
	 * Marca un mensaje como escuchado. Devuelve cuántos quedan pendientes
	 * para quien llama (esto maneja el LED del aparato).
	 */
	markListened: authedProcedure
		.input(z.object({ messageId: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			const { db } = context;
			const caller = callerFromContext(context);

			const found = await db
				.select()
				.from(voiceMessage)
				.where(eq(voiceMessage.id, input.messageId))
				.limit(1);
			const message = found[0];
			if (!message) {
				throw new Error("Mensaje no encontrado");
			}
			const membership = await requireMemberOfGroup(
				db,
				message.groupId,
				caller,
			);

			await db
				.insert(listenReceipt)
				.values({ messageId: message.id, memberId: membership.id })
				.onConflictDoNothing();

			const all = await db
				.select({ id: voiceMessage.id })
				.from(voiceMessage)
				.where(eq(voiceMessage.groupId, message.groupId));
			const mine = await db
				.select({ messageId: listenReceipt.messageId })
				.from(listenReceipt)
				.where(eq(listenReceipt.memberId, membership.id));
			const listenedIds = new Set(mine.map((r) => r.messageId));
			const pendingCount = all.filter((m) => !listenedIds.has(m.id)).length;

			return { ok: true as const, pendingCount };
		}),

	/**
	 * Registra el token de push del celu (opt-in explícito). Sin este llamado
	 * no se envía ninguna notificación (checklist de privacidad).
	 */
	setPushToken: protectedProcedure
		.input(z.object({ token: z.string().min(1).max(256) }))
		.handler(async ({ input, context }) => {
			const userId = context.session.user.id;
			await context.db
				.update(user)
				.set({ pushToken: input.token })
				.where(eq(user.id, userId));
			return { ok: true as const };
		}),
};
