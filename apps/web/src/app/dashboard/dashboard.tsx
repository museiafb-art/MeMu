"use client";

import { useQuery } from "@tanstack/react-query";

import type { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export default function Dashboard({
	session,
}: {
	session: typeof authClient.$Infer.Session;
}) {
	const groups = useQuery(orpc.listGroups.queryOptions());

	return (
		<div className="space-y-4">
			<h2 className="font-semibold text-foreground text-xl">
				Hola, {session.user.name} — tus grupos
			</h2>

			{groups.isPending && (
				<p className="text-muted-foreground">Cargando grupos…</p>
			)}

			{groups.isError && (
				<p className="text-destructive">No se pudieron cargar los grupos.</p>
			)}

			{groups.data && groups.data.length === 0 && (
				<p className="text-muted-foreground">
					Todavía no tenés grupos. En la Fase 1 vas a poder crear el grupo
					"Familia" y mandar tu primer audio.
				</p>
			)}

			{groups.data && groups.data.length > 0 && (
				<ul className="space-y-2">
					{groups.data.map((g) => (
						<li
							key={g.id}
							className="rounded-lg border border-border bg-card p-4 text-card-foreground"
						>
							{g.name}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
