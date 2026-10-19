import { group, member } from "@memu/db/schema/memu";
import type { RouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";

import { protectedProcedure, publicProcedure } from "../index";
import { pairingRouter } from "./pairing";
import { voiceRouter } from "./voice";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),

	/**
	 * Grupos del usuario autenticado.
	 *
	 * Aislamiento por groupId (checklist permanente, sin excepciones): solo
	 * devuelve los grupos donde el usuario es miembro como persona. Los
	 * aparatos usan sus propios endpoints con su token (Fase 1).
	 */
	listGroups: protectedProcedure.handler(async ({ context }) => {
		const userId = context.session.user.id;

		return context.db
			.select({
				id: group.id,
				name: group.name,
				createdAt: group.createdAt,
			})
			.from(member)
			.innerJoin(group, eq(member.groupId, group.id))
			.where(eq(member.userId, userId));
	}),

	/** Mensajes de voz: subida, registro, listado, escuchados, push opt-in. */
	voice: voiceRouter,

	/** Alta y baja de aparatos con código de emparejamiento. */
	pairing: pairingRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
