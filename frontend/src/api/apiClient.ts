/**
 * The single ApiClient instance every component/hook uses (mission §27: one coherent layer,
 * never fetch() scattered around). Its 401 handler is wired to AuthContext from
 * AuthProvider's own effect (see auth/AuthContext.tsx) - this module never imports React or
 * AuthContext itself, keeping the dependency direction one-way.
 */
import { ApiClient } from "./client.js";

export const apiClient = new ApiClient();
