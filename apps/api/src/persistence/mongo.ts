import { MongoClient, MongoServerError } from "mongodb";
import { DuplicateKeyError, type KitDoc, type Repos, type SessionDoc, type UserDoc } from "./types.ts";

const isDuplicate = (e: unknown) => e instanceof MongoServerError && e.code === 11000;

/** Connects, selects `dbName` explicitly (never from the URI path) and ensures indexes. */
export async function connectMongo(uri: string, dbName: string): Promise<{ repos: Repos; close: () => Promise<void> }> {
  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 }).connect();
  const db = client.db(dbName);
  const users = db.collection<UserDoc>("users");
  const sessions = db.collection<SessionDoc>("sessions");
  const kits = db.collection<KitDoc>("kits");

  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    kits.createIndex({ userId: 1, updatedAt: -1 }),
    kits.createIndex({ userId: 1, inputHash: 1 }, { unique: true }),
  ]);

  const insert = async <T>(fn: () => Promise<T>, message: string) => {
    try {
      await fn();
    } catch (e) {
      throw isDuplicate(e) ? new DuplicateKeyError(message) : e;
    }
  };

  const repos: Repos = {
    users: {
      create: (user) => insert(() => users.insertOne(user), "email already registered"),
      findByEmail: (email) => users.findOne({ email }),
      findById: (id) => users.findOne({ _id: id }),
    },
    sessions: {
      create: async (s) => void (await sessions.insertOne(s)),
      find: (id) => sessions.findOne({ _id: id }),
      delete: async (id) => void (await sessions.deleteOne({ _id: id })),
    },
    kits: {
      insert: (kit) => insert(() => kits.insertOne(kit), "kit already exists"),
      get: (userId, id) => kits.findOne({ _id: id, userId }),
      getById: (id) => kits.findOne({ _id: id }),
      findByInputHash: (userId, inputHash) => kits.findOne({ userId, inputHash }),
      list: (userId) => kits.find({ userId }, { projection: { progress: 0, researchCache: 0 } }).sort({ updatedAt: -1 }).toArray(),
      update: async (id, patch) => void (await kits.updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date() } })),
      casKit: async (userId, id, expectedVersion, kit, extra = {}) =>
        (await kits.updateOne({ _id: id, userId, version: expectedVersion }, { $set: { ...extra, kit, version: expectedVersion + 1, updatedAt: new Date() } }))
          .matchedCount === 1,
      delete: async (userId, id) => (await kits.deleteOne({ _id: id, userId })).deletedCount === 1,
      findByStatus: (statuses) => kits.find({ status: { $in: statuses } }).toArray(),
    },
  };
  return { repos, close: () => client.close() };
}
