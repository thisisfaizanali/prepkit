// In-memory repositories for tests: same contract as Mongo, including unique keys and copies on read/write.
import { DuplicateKeyError, type KitDoc, type Repos, type SessionDoc, type UserDoc } from "./types.ts";

const copy = <T>(x: T): T => structuredClone(x);

export function createMemoryRepos(now: () => number = Date.now): Repos {
  const users = new Map<string, UserDoc>();
  const sessions = new Map<string, SessionDoc>();
  const kits = new Map<string, KitDoc>();

  return {
    users: {
      async create(user) {
        if ([...users.values()].some((u) => u.email === user.email)) throw new DuplicateKeyError("email already registered");
        users.set(user._id, copy(user));
      },
      findByEmail: async (email) => copy([...users.values()].find((u) => u.email === email) ?? null),
      findById: async (id) => copy(users.get(id) ?? null),
    },
    sessions: {
      create: async (s) => void sessions.set(s._id, copy(s)),
      // Mongo's TTL monitor deletes expired sessions lazily; mimic "not deleted yet" and let the caller check expiresAt.
      find: async (id) => copy(sessions.get(id) ?? null),
      delete: async (id) => void sessions.delete(id),
    },
    kits: {
      async insert(kit) {
        if ([...kits.values()].some((k) => k.userId === kit.userId && k.inputHash === kit.inputHash)) throw new DuplicateKeyError("kit already exists");
        kits.set(kit._id, copy(kit));
      },
      get: async (userId, id) => copy(kits.get(id)?.userId === userId ? kits.get(id)! : null),
      getById: async (id) => copy(kits.get(id) ?? null),
      findByInputHash: async (userId, hash) => copy([...kits.values()].find((k) => k.userId === userId && k.inputHash === hash) ?? null),
      list: async (userId) =>
        [...kits.values()]
          .filter((k) => k.userId === userId)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .map(({ progress: _p, researchCache: _r, ...k }) => copy(k)),
      async update(id, patch) {
        const k = kits.get(id);
        if (k) kits.set(id, { ...k, ...copy(patch), updatedAt: new Date(now()) });
      },
      async casKit(userId, id, expectedVersion, kit, extra = {}) {
        const k = kits.get(id);
        if (!k || k.userId !== userId || k.version !== expectedVersion) return false;
        kits.set(id, { ...k, ...copy(extra), kit: copy(kit), version: expectedVersion + 1, updatedAt: new Date(now()) });
        return true;
      },
      async claimRegeneration(userId, id, regeneration) {
        const k = kits.get(id);
        if (!k || k.userId !== userId || k.regeneration?.status === "running") return false;
        kits.set(id, { ...k, regeneration: copy(regeneration), updatedAt: new Date(now()) });
        return true;
      },
      async failRunningRegenerations(error, at) {
        const stuck = [...kits.values()].filter((k) => k.regeneration?.status === "running");
        for (const k of stuck) k.regeneration = { ...k.regeneration!, status: "failed", error: { ...error }, finishedAt: at };
        return stuck.length;
      },
      async delete(userId, id) {
        return kits.get(id)?.userId === userId && kits.delete(id);
      },
      findByStatus: async (statuses) => [...kits.values()].filter((k) => statuses.includes(k.status)).map(copy),
    },
  };
}
