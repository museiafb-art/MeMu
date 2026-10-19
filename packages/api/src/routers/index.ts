import { group, member } from "@memu/db/schema/memu";
import type { RouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";

import { protectedProcedure, publicProcedure } from "../index";

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
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
