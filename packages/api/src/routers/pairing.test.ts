import { user } from "@memu/db/schema/auth";
import {
	device,
	deviceToken,
	group,
	member,
	pairingCode,
} from "@memu/db/schema/memu";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Context } from "../context";
import { hashDeviceToken } from "../device-auth";
import { createTestDb, must } from "../test-utils";
import { pairingRouter } from "./pairing";

const ctx = (overrides: Partial<Context> = {}): Context =>
	({
		db: null,
		session: null,
		device: null,
		...overrides,
	}) as unknown as Context;

async function seedFamily(db: ReturnType<typeof createTestDb>) {
	const u = must(
		(
			await db
				.insert(user)
				.values({ id: "u-sofi", name: "Sofi", email: "sofi@x.com" })
				.returning()
		)[0],
	);
	const g = must(
		(await db.insert(group).values({ name: "Familia" }).returning())[0],
	);
	await db
		.insert(member)
		.values({ groupId: g.id, memberType: "person", userId: u.id });
	return { u, g };
}

describe("createPairingCode", () => {
	it("genera un código de 6 caracteres asociado al grupo", async () => {
		const db = createTestDb();
		const { u, g } = await seedFamily(db);
		const context = ctx({ db, session: { user: { id: u.id } } as never });

		const result = await call(
			pairingRouter.createPairingCode,
			{ groupId: g.id },
			{ context },
		);
		expect(result.code).toMatch(/^[A-Z2-9]{6}$/);
		expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

		const rows = await db
			.select()
			.from(pairingCode)
			.where(eq(pairingCode.code, result.code));
		expect(rows).toHaveLength(1);
		expect(must(rows[0]).groupId).toBe(g.id);
	});

	it("rechaza si no soy miembro del grupo (FORBIDDEN)", async () => {
		const db = createTestDb();
		const { g } = await seedFamily(db);
		const intruso = must(
			(
				await db
					.insert(user)
					.values({ id: "u-x", name: "X", email: "x@x.com" })
					.returning()
			)[0],
		);
		const context = ctx({ db, session: { user: { id: intruso.id } } as never });
		await expect(
			call(pairingRouter.createPairingCode, { groupId: g.id }, { context }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("rechaza sin sesión (UNAUTHORIZED)", async () => {
		const db = createTestDb();
		const { g } = await seedFamily(db);
		await expect(
			call(
				pairingRouter.createPairingCode,
				{ groupId: g.id },
				{ context: ctx({ db }) },
			),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("claimPairingCode (flujo feliz)", () => {
	it("canjea el código por un token: crea aparato + miembro, guarda solo el hash", async () => {
		const db = createTestDb();
		const { u, g } = await seedFamily(db);
		const personCtx = ctx({ db, session: { user: { id: u.id } } as never });
		const { code } = await call(
			pairingRouter.createPairingCode,
			{ groupId: g.id },
			{ context: personCtx },
		);

		const claimed = await call(
			pairingRouter.claimPairingCode,
			{ code, deviceName: "Aparato de la abuela" },
			{ context: ctx({ db }) },
		);
		expect(claimed.deviceId).toBeTruthy();
		expect(claimed.token).toHaveLength(64);

		// El aparato quedó como miembro del grupo
		const members = await db
			.select()
			.from(member)
			.where(eq(member.deviceId, claimed.deviceId));
		expect(members).toHaveLength(1);
		expect(must(members[0]).groupId).toBe(g.id);
		expect(must(members[0]).memberType).toBe("device");

		// En la base solo está el hash, nunca el token en claro
		const tokens = await db
			.select()
			.from(deviceToken)
			.where(eq(deviceToken.deviceId, claimed.deviceId));
		expect(tokens).toHaveLength(1);
		expect(must(tokens[0]).tokenHash).toBe(hashDeviceToken(claimed.token));
		expect(must(tokens[0]).tokenHash).not.toContain(claimed.token);
		expect(must(tokens[0]).revokedAt).toBeNull();

		// El código quedó marcado como usado
		const codes = await db
			.select()
			.from(pairingCode)
			.where(eq(pairingCode.code, code));
		expect(must(codes[0]).usedAt).not.toBeNull();

		// El token resuelve la identidad del aparato
		const { resolveDeviceAuth } = await import("../device-auth");
		const identity = await resolveDeviceAuth(db, `Bearer ${claimed.token}`);
		expect(identity?.deviceId).toBe(claimed.deviceId);
	});
});

describe("claimPairingCode (abusos)", () => {
	it("un código no se puede reusar", async () => {
		const db = createTestDb();
		const { u, g } = await seedFamily(db);
		const personCtx = ctx({ db, session: { user: { id: u.id } } as never });
		const { code } = await call(
			pairingRouter.createPairingCode,
			{ groupId: g.id },
			{ context: personCtx },
		);
		await call(
			pairingRouter.claimPairingCode,
			{ code, deviceName: "Uno" },
			{ context: ctx({ db }) },
		);
		await expect(
			call(
				pairingRouter.claimPairingCode,
				{ code, deviceName: "Dos" },
				{ context: ctx({ db }) },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("un código expirado no sirve", async () => {
		const db = createTestDb();
		const { u, g } = await seedFamily(db);
		const personCtx = ctx({ db, session: { user: { id: u.id } } as never });
		const { code } = await call(
			pairingRouter.createPairingCode,
			{ groupId: g.id },
			{ context: personCtx },
		);
		// lo expiro a mano
		await db
			.update(pairingCode)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(pairingCode.code, code));
		await expect(
			call(
				pairingRouter.claimPairingCode,
				{ code, deviceName: "Tarde" },
				{ context: ctx({ db }) },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("un código inexistente no sirve", async () => {
		const db = createTestDb();
		await expect(
			call(
				pairingRouter.claimPairingCode,
				{ code: "ZZZZZZ", deviceName: "X" },
				{ context: ctx({ db }) },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("revokeDeviceToken", () => {
	it("revoca los tokens del aparato y el token deja de resolver", async () => {
		const db = createTestDb();
		const { u, g } = await seedFamily(db);
		const personCtx = ctx({ db, session: { user: { id: u.id } } as never });
		const { code } = await call(
			pairingRouter.createPairingCode,
			{ groupId: g.id },
			{ context: personCtx },
		);
		const { deviceId, token } = await call(
			pairingRouter.claimPairingCode,
			{ code, deviceName: "Abuela" },
			{ context: ctx({ db }) },
		);

		const result = await call(
			pairingRouter.revokeDeviceToken,
			{ deviceId },
			{ context: personCtx },
		);
		expect(result.revokedCount).toBe(1);

		const { resolveDeviceAuth } = await import("../device-auth");
		expect(await resolveDeviceAuth(db, `Bearer ${token}`)).toBeNull();

		// segunda revocación no encuentra nada vigente
		const again = await call(
			pairingRouter.revokeDeviceToken,
			{ deviceId },
			{ context: personCtx },
		);
		expect(again.revokedCount).toBe(0);
	});

	it("un extraño no puede revocar mi aparato (FORBIDDEN)", async () => {
		const db = createTestDb();
		const { u, g } = await seedFamily(db);
		const personCtx = ctx({ db, session: { user: { id: u.id } } as never });
		const { code } = await call(
			pairingRouter.createPairingCode,
			{ groupId: g.id },
			{ context: personCtx },
		);
		const { deviceId } = await call(
			pairingRouter.claimPairingCode,
			{ code, deviceName: "Abuela" },
			{ context: ctx({ db }) },
		);

		const intruso = must(
			(
				await db
					.insert(user)
					.values({ id: "u-x", name: "X", email: "x@x.com" })
					.returning()
			)[0],
		);
		const intrusoCtx = ctx({
			db,
			session: { user: { id: intruso.id } } as never,
		});
		await expect(
			call(
				pairingRouter.revokeDeviceToken,
				{ deviceId },
				{ context: intrusoCtx },
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });

		// el aparato sigue existiendo
		const devs = await db.select().from(device).where(eq(device.id, deviceId));
		expect(devs).toHaveLength(1);
	});
});

beforeEach(() => {
	// nada global que resetear acá
});
