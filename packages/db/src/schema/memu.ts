import { defineRelationsPart } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

const newId = () => crypto.randomUUID();

/**
 * Aparatos físicos (ESP32). Cada fila es una "cajita" con micrófono y parlante.
 * Un aparato pertenece a sus grupos a través de `member` (Fase 1: un grupo por aparato).
 */
export const device = pgTable("device", {
	id: text("id").primaryKey().$defaultFn(newId),
	name: text("name").notNull(),
	isOnline: boolean("is_online").default(false).notNull(),
	lastSeenAt: timestamp("last_seen_at"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Tokens de aparato ("DNI" secreto de cada cajita).
 * Se guarda el HASH (SHA-256) del token, nunca el token en claro.
 * `revokedAt` != null significa dado de baja (ej. se perdió el aparato).
 */
export const deviceToken = pgTable(
	"device_token",
	{
		id: text("id").primaryKey().$defaultFn(newId),
		deviceId: text("device_id")
			.notNull()
			.references(() => device.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull(),
		label: text("label"),
		revokedAt: timestamp("revoked_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("device_token_device_idx").on(table.deviceId)],
);

/**
 * Grupos de mensajería (ej. "Familia"). Mezclan personas y aparatos vía `member`.
 * (La tabla se llama "groups" porque "group" es palabra reservada en Postgres.)
 */
export const group = pgTable("groups", {
	id: text("id").primaryKey().$defaultFn(newId),
	name: text("name").notNull(),
	createdById: text("created_by_id").references(() => user.id, {
		onDelete: "set null",
	}),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Miembros de un grupo. Cada miembro es una persona O un aparato (uno de los
 * dos FK es null). `memberType` vale 'person' | 'device' (validado con Zod en la API).
 */
export const member = pgTable(
	"member",
	{
		id: text("id").primaryKey().$defaultFn(newId),
		groupId: text("group_id")
			.notNull()
			.references(() => group.id, { onDelete: "cascade" }),
		memberType: text("member_type").notNull(),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		deviceId: text("device_id").references(() => device.id, {
			onDelete: "cascade",
		}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("member_group_idx").on(table.groupId)],
);

/**
 * Mensajes de voz. El audio vive en el bucket privado; acá solo se anota dónde
 * está (`storageKey`), cuánto dura y quién lo mandó (un miembro del grupo).
 * Borrar un grupo borra sus mensajes en cascada (ver spec 05, borrado real).
 */
export const voiceMessage = pgTable(
	"voice_message",
	{
		id: text("id").primaryKey().$defaultFn(newId),
		groupId: text("group_id")
			.notNull()
			.references(() => group.id, { onDelete: "cascade" }),
		senderMemberId: text("sender_member_id").references(() => member.id, {
			onDelete: "set null",
		}),
		storageKey: text("storage_key").notNull(),
		durationSeconds: integer("duration_seconds").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("voice_message_group_idx").on(table.groupId)],
);

/**
 * Recibos de escucha: una marquita por miembro y mensaje ("ya lo escuché").
 * unique(messageId, memberId): cada miembro marca cada mensaje una sola vez.
 */
export const listenReceipt = pgTable(
	"listen_receipt",
	{
		id: text("id").primaryKey().$defaultFn(newId),
		messageId: text("message_id")
			.notNull()
			.references(() => voiceMessage.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		listenedAt: timestamp("listened_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("listen_receipt_message_member_uidx").on(
			table.messageId,
			table.memberId,
		),
	],
);

/**
 * Códigos de emparejamiento (pairing) para dar de alta un aparato.
 * La app (persona autenticada) genera un código corto de un solo uso asociado
 * a un grupo; el aparato lo canjea por su token largo (ver `claimPairingCode`).
 * Expiran a los 10 minutos y no se pueden reusar (`usedAt`).
 */
export const pairingCode = pgTable(
	"pairing_code",
	{
		id: text("id").primaryKey().$defaultFn(newId),
		code: text("code").notNull().unique(),
		groupId: text("group_id")
			.notNull()
			.references(() => group.id, { onDelete: "cascade" }),
		createdById: text("created_by_id").references(() => user.id, {
			onDelete: "set null",
		}),
		expiresAt: timestamp("expires_at").notNull(),
		usedAt: timestamp("used_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("pairing_code_code_idx").on(table.code)],
);

export const memuRelations = defineRelationsPart(
	{ device, deviceToken, group, member, voiceMessage, listenReceipt, user },
	(r) => ({
		device: {
			tokens: r.many.deviceToken({
				from: r.device.id,
				to: r.deviceToken.deviceId,
			}),
			memberships: r.many.member({
				from: r.device.id,
				to: r.member.deviceId,
			}),
		},
		deviceToken: {
			device: r.one.device({
				from: r.deviceToken.deviceId,
				to: r.device.id,
			}),
		},
		group: {
			members: r.many.member({
				from: r.group.id,
				to: r.member.groupId,
			}),
			messages: r.many.voiceMessage({
				from: r.group.id,
				to: r.voiceMessage.groupId,
			}),
		},
		member: {
			group: r.one.group({
				from: r.member.groupId,
				to: r.group.id,
			}),
			user: r.one.user({
				from: r.member.userId,
				to: r.user.id,
			}),
			device: r.one.device({
				from: r.member.deviceId,
				to: r.device.id,
			}),
			sentMessages: r.many.voiceMessage({
				from: r.member.id,
				to: r.voiceMessage.senderMemberId,
			}),
			receipts: r.many.listenReceipt({
				from: r.member.id,
				to: r.listenReceipt.memberId,
			}),
		},
		voiceMessage: {
			group: r.one.group({
				from: r.voiceMessage.groupId,
				to: r.group.id,
			}),
			sender: r.one.member({
				from: r.voiceMessage.senderMemberId,
				to: r.member.id,
			}),
			receipts: r.many.listenReceipt({
				from: r.voiceMessage.id,
				to: r.listenReceipt.messageId,
			}),
		},
		listenReceipt: {
			message: r.one.voiceMessage({
				from: r.listenReceipt.messageId,
				to: r.voiceMessage.id,
			}),
			member: r.one.member({
				from: r.listenReceipt.memberId,
				to: r.member.id,
			}),
		},
	}),
);
