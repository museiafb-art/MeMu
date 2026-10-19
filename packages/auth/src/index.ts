import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import type { Database } from "@memu/db";
import * as schema from "@memu/db/schema/auth";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
};

export function createAuth(env: AuthConfig, database: Database) {
	return betterAuth({
		database: drizzleAdapter(database, {
			provider: "pg",
			schema,
		}),
		trustedOrigins: [
			env.BETTER_AUTH_URL,
			"memu://",
			"exp://",
			"http://localhost:8081",
		],
		emailAndPassword: { enabled: true },
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		plugins: [nextCookies(), expo()],
	});
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
