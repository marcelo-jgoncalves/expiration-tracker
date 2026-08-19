/**
 * User repository — data-model.md §2 (`TENANT#t#USER#u` / `PROFILE`) plus the session-
 * revocation fields required by implementation-blueprint.md §4.2 ("Logout por dispositivo
 * atualiza deviceLogoutAfter/revoga a família de refresh. Logout global atualiza
 * globalLogoutAfter"). data-model.md doesn't enumerate a standalone Session entity, so
 * this module keeps revocation watermarks on the User item itself (globalLogoutAfter) and
 * per-device entries as child items under the same tenant partition
 * (`TENANT#t#USER#u` / `SESSION#<deviceId>`) rather than inventing a new top-level
 * aggregate — see the M1 report for this judgment call.
 */
import type { EntityKey, IdentityStore } from "../ports/identity-store.js";

export interface UserProfile {
  PK: string;
  SK: "PROFILE";
  entityType: "User";
  userId: string;
  tenantId: string;
  identitySubject: string;
  emailNormalized: string;
  roles: string[];
  status: "ACTIVE" | "SUSPENDED";
  globalLogoutAfter?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface DeviceSession {
  PK: string;
  SK: string; // SESSION#<deviceId>
  entityType: "DeviceSession";
  tenantId: string;
  userId: string;
  deviceId: string;
  sessionId: string;
  refreshFamilyId: string;
  deviceLogoutAfter?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  status: "ACTIVE" | "REVOKED";
}

export function userProfileKey(tenantId: string, userId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#USER#${userId}`, SK: "PROFILE" };
}

export function deviceSessionKey(tenantId: string, userId: string, deviceId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#USER#${userId}`, SK: `SESSION#${deviceId}` };
}

export class UserRepository {
  constructor(
    private readonly store: IdentityStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async getProfile(tenantId: string, userId: string): Promise<UserProfile | undefined> {
    return this.store.get<UserProfile>(userProfileKey(tenantId, userId));
  }

  async createProfileIfAbsent(profile: Omit<UserProfile, "PK" | "SK" | "entityType" | "createdAt" | "updatedAt" | "version">): Promise<UserProfile> {
    const key = userProfileKey(profile.tenantId, profile.userId);
    const existing = await this.getProfile(profile.tenantId, profile.userId);
    if (existing) {
      return existing;
    }
    const now = this.now();
    const item: UserProfile = {
      ...key,
      SK: "PROFILE",
      entityType: "User",
      ...profile,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.putIfAbsent(item);
    return item;
  }

  async getDeviceSession(tenantId: string, userId: string, deviceId: string): Promise<DeviceSession | undefined> {
    return this.store.get<DeviceSession>(deviceSessionKey(tenantId, userId, deviceId));
  }

  async upsertDeviceSession(session: DeviceSession): Promise<void> {
    await this.store.update(session);
  }

  /** Logout global — implementation-blueprint.md §4.2: revokes every token issued before now. */
  async logoutAll(tenantId: string, userId: string): Promise<void> {
    const profile = await this.getProfile(tenantId, userId);
    if (!profile) return;
    await this.store.update({ ...profile, globalLogoutAfter: this.now(), updatedAt: this.now() });
  }

  /** Logout by device — revokes only this device's refresh family. */
  async logoutDevice(tenantId: string, userId: string, deviceId: string): Promise<void> {
    const session = await this.getDeviceSession(tenantId, userId, deviceId);
    if (!session) return;
    await this.store.update({ ...session, status: "REVOKED", deviceLogoutAfter: this.now() });
  }
}
