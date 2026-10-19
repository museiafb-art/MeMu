import { createAuth } from "@memu/auth";
import { createDb } from "@memu/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
