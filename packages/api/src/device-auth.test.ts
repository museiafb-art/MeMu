import { user } from "@memu/db/schema/auth";
import { device, deviceToken, group, member } from "@memu/db/schema/memu";
import { call } from "@orpc/server";
import { beforeEach, describe, expect, it } from "vitest";

import type { Context } from "./context";
import {
	authedProcedure,
	buildDeviceProcedure,
	createRateLimiter,
	deviceRateLimiter,
	generateDeviceToken,
	hashDeviceToken,
	requireMemberOfGroup,
	resolveDeviceAuth,
} from "./device-auth";
import { createTestDb, must } from "./test-utils";

const ctx = (overrides: Partial<Context> = {}): Context =>
	({
		db: null,
		session: null,
		device: null,
		...overrides,
	}) as unknown as Context;

describe("hash y generación de tokens", () => {
	it("el hash es determinista y no expone el token", () => {
		const token = generateDeviceToken();
		expect(hashDeviceToken(token)).toBe(hashDeviceToken(token));
		expect(hashDeviceToken(token)).not.toContain(token);
		expect(hashDeviceToken(token)).toHaveLength(64);
	});

	it("cada token generado es único", () => {
		expect(generateDeviceToken()).not.toBe(generateDeviceToken());
	});
});

describe("resolveDeviceAuth", () => {
	it("resuelve un token válido", async () => {
		const db = createTestDb();
		const dev = must(
			(await db.insert(device).values({ name: "Abuela" }).returning())[0],
		);
		const token = generateDeviceToken();
		const row = must(
			(
				await db
					.insert(deviceToken)
					.values({ deviceId: dev.id, tokenHash: hashDeviceToken(token) })
					.returning()
			)[0],
		);
		const identity = await resolveDeviceAuth(db, `Bearer ${token}`);
		expect(identity).toEqual({ tokenId: row.id, deviceId: dev.id });
	});

	it("rechaza token desconocido, revocado o header malformado", async () => {
		const db = createTestDb();
		const dev = must(
			(await db.insert(device).values({ name: "Abuela" }).returning())[0],
		);
		const token = generateDeviceToken();
		await db.insert(deviceToken).values({
			deviceId: dev.id,
			tokenHash: hashDeviceToken(token),
			revokedAt: new Date(),
		});

		expect(await resolveDeviceAuth(db, "Bearer invalido")).toBeNull();
		expect(await resolveDeviceAuth(db, `Bearer ${token}`)).toBeNull(); // revocado
		expect(await resolveDeviceAuth(db, null)).toBeNull();
		expect(await resolveDeviceAuth(db, "Basic abc")).toBeNull();
	});
});

describe("rate limiter", () => {
	it("permite hasta el límite y bloquea después", () => {
		const rl = createRateLimiter({ limit: 3, windowMs: 60_000 });
		expect(rl.consume("k")).toBe(true);
		expect(rl.consume("k")).toBe(true);
		expect(rl.consume("k")).toBe(true);
		expect(rl.consume("k")).toBe(false);
		// otra key no se ve afectada
		expect(rl.consume("otra")).toBe(true);
		rl.reset();
		expect(rl.consume("k")).toBe(true);
	});

	it("el limiter de producción es 60 req/min", () => {
		deviceRateLimiter.reset();
		for (let i = 0; i < 60; i++) {
			expect(deviceRateLimiter.consume("prod")).toBe(true);
		}
		expect(deviceRateLimiter.consume("prod")).toBe(false);
		deviceRateLimiter.reset();
	});
});

describe("deviceProcedure", () => {
	it("rechaza sin dispositivo en contexto (UNAUTHORIZED)", async () => {
		const proc = buildDeviceProcedure(
			createRateLimiter({ limit: 60, windowMs: 60_000 }),
		);
		const handler = proc.handler(() => "ok");
		await expect(call(handler, {}, { context: ctx() })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("rechaza cuando se excede el rate limit (TOO_MANY_REQUESTS)", async () => {
		const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
		const proc = buildDeviceProcedure(rl);
		const handler = proc.handler(() => "ok");
		const context = ctx({ device: { tokenId: "t1", deviceId: "d1" } });
		await expect(call(handler, {}, { context })).resolves.toBe("ok");
		await expect(call(handler, {}, { context })).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		});
	});

	it("pasa con dispositivo válido dentro del límite", async () => {
		const proc = buildDeviceProcedure(
			createRateLimiter({ limit: 60, windowMs: 60_000 }),
		);
		const handler = proc.handler(({ context }) => context.device.deviceId);
		const context = ctx({ device: { tokenId: "t1", deviceId: "d1" } });
		await expect(call(handler, {}, { context })).resolves.toBe("d1");
	});
});

describe("authedProcedure", () => {
	it("acepta persona con sesión o aparato con token", async () => {
		const handler = authedProcedure.handler(() => "ok");
		await expect(
			call(
				handler,
				{},
				{ context: ctx({ session: { user: { id: "u1" } } as never }) },
			),
		).resolves.toBe("ok");
		await expect(
			call(
				handler,
				{},
				{ context: ctx({ device: { tokenId: "t", deviceId: "d" } }) },
			),
		).resolves.toBe("ok");
	});

	it("rechaza sin ninguna credencial", async () => {
		const handler = authedProcedure.handler(() => "ok");
		await expect(call(handler, {}, { context: ctx() })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});
});

describe("aislamiento por groupId", () => {
	it("requireMemberOfGroup rechaza a quien no es miembro (FORBIDDEN)", async () => {
		const db = createTestDb();
		const u = must(
			(
				await db
					.insert(user)
					.values({ id: "u1", name: "Sofi", email: "s@x.com" })
					.returning()
			)[0],
		);
		const g = must(
			(await db.insert(group).values({ name: "Familia" }).returning())[0],
		);
		await expect(
			requireMemberOfGroup(db, g.id, { userId: u.id }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });

		await db
			.insert(member)
			.values({ groupId: g.id, memberType: "person", userId: u.id });
		const row = await requireMemberOfGroup(db, g.id, { userId: u.id });
		expect(row.groupId).toBe(g.id);
	});
});

beforeEach(() => {
	deviceRateLimiter.reset();
});
