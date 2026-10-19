import type { AppRouterClient } from "@memu/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";

import { ENV } from "../src/env";

export const queryClient = new QueryClient({
	queryCache: new QueryCache({
		onError: (error) => {
			console.log(error);
		},
	}),
});

async function expoFetch(request: Request, init?: RequestInit) {
	const { fetch } = await import("expo/fetch");

	return fetch(request.url, {
		body: await request.blob(),
		headers: request.headers,
		method: request.method,
		signal: request.signal,
		...init,
	});
}

export const link = new RPCLink({
	url: `${ENV.EXPO_PUBLIC_SERVER_URL}/api/rpc`,
	fetch(request, init) {
		return expoFetch(request, {
			...init,
			// Better Auth Expo forwards the session cookie manually on native.
			credentials: Platform.OS === "web" ? "include" : "omit",
		});
	},
	async headers() {
		if (Platform.OS === "web") {
			return {};
		}
		const headers = new Map<string, string>();
		const cookies = await authClient.getCookie();
		if (cookies) {
			headers.set("Cookie", cookies);
		}
		return Object.fromEntries(headers);
	},
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
