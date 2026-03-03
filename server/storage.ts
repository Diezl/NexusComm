import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and, or, desc, sql, ne, inArray } from "drizzle-orm";
import {
  users, channels, channelMembers, messages, calls,
  type User, type InsertUser, type Channel, type InsertChannel,
  type Message, type InsertMessage, type Call,
  type MessageWithUser, type ChannelWithMeta, type UserPublic
} from "@shared/schema";
import { randomUUID } from "crypto";
import * as crypto from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "nexus_salt").digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export interface IStorage {
  createUser(user: InsertUser): Promise<User>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<UserPublic[]>;
  updateUserStatus(id: string, status: string): Promise<void>;
  updateUser(id: string, data: Partial<Pick<User, "displayName" | "avatar" | "department" | "role">>): Promise<User>;

  createChannel(channel: InsertChannel): Promise<Channel>;
  getChannelById(id: string): Promise<Channel | undefined>;
  getAllChannels(): Promise<ChannelWithMeta[]>;
  getUserChannels(userId: string): Promise<ChannelWithMeta[]>;
  addChannelMember(channelId: string, userId: string): Promise<void>;
  removeChannelMember(channelId: string, userId: string): Promise<void>;
  isChannelMember(channelId: string, userId: string): Promise<boolean>;
  getChannelMembers(channelId: string): Promise<UserPublic[]>;

  createMessage(message: InsertMessage): Promise<Message>;
  getChannelMessages(channelId: string, limit?: number): Promise<MessageWithUser[]>;
  getDirectMessages(userId1: string, userId2: string, limit?: number): Promise<MessageWithUser[]>;

  createCall(call: Partial<Call>): Promise<Call>;
  updateCallStatus(id: string, status: string, startedAt?: Date, endedAt?: Date): Promise<void>;
  getCallById(id: string): Promise<Call | undefined>;
}

export class DatabaseStorage implements IStorage {
  async createUser(insertUser: InsertUser): Promise<User> {
    const hashed = hashPassword(insertUser.password);
    const [user] = await db.insert(users).values({
      ...insertUser,
      password: hashed,
      id: randomUUID(),
    }).returning();
    return user;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getAllUsers(): Promise<UserPublic[]> {
    const result = await db.select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      role: users.role,
      department: users.department,
      status: users.status,
      lastSeen: users.lastSeen,
      createdAt: users.createdAt,
    }).from(users).orderBy(users.displayName);
    return result;
  }

  async updateUserStatus(id: string, status: string): Promise<void> {
    await db.update(users).set({ status, lastSeen: new Date() }).where(eq(users.id, id));
  }

  async updateUser(id: string, data: Partial<Pick<User, "displayName" | "avatar" | "department" | "role">>): Promise<User> {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }

  async createChannel(channel: InsertChannel): Promise<Channel> {
    const [created] = await db.insert(channels).values({
      ...channel,
      id: randomUUID(),
    }).returning();
    return created;
  }

  async getChannelById(id: string): Promise<Channel | undefined> {
    const [channel] = await db.select().from(channels).where(eq(channels.id, id));
    return channel;
  }

  async getAllChannels(): Promise<ChannelWithMeta[]> {
    const allChannels = await db.select().from(channels).where(eq(channels.isPrivate, false)).orderBy(channels.name);
    return Promise.all(allChannels.map(async (ch) => {
      const [countResult] = await db.select({ count: sql<number>`count(*)` })
        .from(channelMembers).where(eq(channelMembers.channelId, ch.id));
      return { ...ch, memberCount: Number(countResult?.count ?? 0) };
    }));
  }

  async getUserChannels(userId: string): Promise<ChannelWithMeta[]> {
    const memberOf = await db.select({ channelId: channelMembers.channelId })
      .from(channelMembers).where(eq(channelMembers.userId, userId));
    const channelIds = memberOf.map(m => m.channelId);
    if (channelIds.length === 0) return [];
    const result = await Promise.all(channelIds.map(async (cid) => {
      const [ch] = await db.select().from(channels).where(eq(channels.id, cid));
      if (!ch) return null;
      const [countResult] = await db.select({ count: sql<number>`count(*)` })
        .from(channelMembers).where(eq(channelMembers.channelId, cid));
      return { ...ch, memberCount: Number(countResult?.count ?? 0) } as ChannelWithMeta;
    }));
    return result.filter(Boolean) as ChannelWithMeta[];
  }

  async addChannelMember(channelId: string, userId: string): Promise<void> {
    const existing = await this.isChannelMember(channelId, userId);
    if (!existing) {
      await db.insert(channelMembers).values({ channelId, userId });
    }
  }

  async removeChannelMember(channelId: string, userId: string): Promise<void> {
    await db.delete(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
  }

  async isChannelMember(channelId: string, userId: string): Promise<boolean> {
    const [m] = await db.select().from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
    return !!m;
  }

  async getChannelMembers(channelId: string): Promise<UserPublic[]> {
    const members = await db.select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      role: users.role,
      department: users.department,
      status: users.status,
      lastSeen: users.lastSeen,
      createdAt: users.createdAt,
    }).from(channelMembers)
      .innerJoin(users, eq(channelMembers.userId, users.id))
      .where(eq(channelMembers.channelId, channelId));
    return members;
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const [created] = await db.insert(messages).values({
      ...message,
      id: randomUUID(),
    }).returning();
    return created;
  }

  async getChannelMessages(channelId: string, limit = 50): Promise<MessageWithUser[]> {
    const msgs = await db.select().from(messages)
      .where(eq(messages.channelId, channelId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return this.enrichMessages(msgs.reverse());
  }

  async getDirectMessages(userId1: string, userId2: string, limit = 50): Promise<MessageWithUser[]> {
    const msgs = await db.select().from(messages)
      .where(
        and(
          sql`${messages.channelId} IS NULL`,
          or(
            and(eq(messages.fromUserId, userId1), eq(messages.toUserId, userId2)),
            and(eq(messages.fromUserId, userId2), eq(messages.toUserId, userId1))
          )
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return this.enrichMessages(msgs.reverse());
  }

  private async enrichMessages(msgs: Message[]): Promise<MessageWithUser[]> {
    if (msgs.length === 0) return [];
    const userIds = [...new Set(msgs.map(m => m.fromUserId))];
    const usersData = await db.select({
      id: users.id,
      displayName: users.displayName,
      avatar: users.avatar,
      username: users.username,
    }).from(users).where(inArray(users.id, userIds));
    const userMap = new Map(usersData.map(u => [u.id, u]));
    return msgs.map(m => ({
      ...m,
      user: userMap.get(m.fromUserId) || { id: m.fromUserId, displayName: "Unknown", avatar: null, username: "unknown" },
    }));
  }

  async createCall(callData: Partial<Call>): Promise<Call> {
    const [created] = await db.insert(calls).values({
      id: randomUUID(),
      initiatorId: callData.initiatorId!,
      participantId: callData.participantId,
      channelId: callData.channelId,
      type: callData.type || "video",
      status: "ringing",
    }).returning();
    return created;
  }

  async updateCallStatus(id: string, status: string, startedAt?: Date, endedAt?: Date): Promise<void> {
    await db.update(calls).set({
      status,
      ...(startedAt ? { startedAt } : {}),
      ...(endedAt ? { endedAt } : {}),
    }).where(eq(calls.id, id));
  }

  async getCallById(id: string): Promise<Call | undefined> {
    const [call] = await db.select().from(calls).where(eq(calls.id, id));
    return call;
  }
}

export const storage = new DatabaseStorage();

export async function seedDatabase() {
  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) return;

  const seedUsers = [
    { username: "admin", password: "password123", displayName: "Alex Morgan", role: "admin", department: "Leadership", avatar: null },
    { username: "sarah.chen", password: "password123", displayName: "Sarah Chen", role: "manager", department: "Engineering", avatar: null },
    { username: "marcus.j", password: "password123", displayName: "Marcus Johnson", role: "employee", department: "Engineering", avatar: null },
    { username: "priya.k", password: "password123", displayName: "Priya Kapoor", role: "employee", department: "Design", avatar: null },
    { username: "tom.wilson", password: "password123", displayName: "Tom Wilson", role: "employee", department: "Marketing", avatar: null },
    { username: "emily.davis", password: "password123", displayName: "Emily Davis", role: "manager", department: "HR", avatar: null },
  ];

  const createdUsers: User[] = [];
  for (const u of seedUsers) {
    const user = await storage.createUser(u);
    await storage.updateUserStatus(user.id, u.username === "admin" ? "online" : "offline");
    createdUsers.push(user);
  }

  const seedChannels = [
    { name: "general", description: "Company-wide announcements and conversations", isPrivate: false, createdBy: createdUsers[0].id },
    { name: "engineering", description: "Engineering team discussions", isPrivate: false, createdBy: createdUsers[1].id },
    { name: "design", description: "Design team workspace", isPrivate: false, createdBy: createdUsers[3].id },
    { name: "marketing", description: "Marketing campaigns and strategy", isPrivate: false, createdBy: createdUsers[4].id },
    { name: "random", description: "Off-topic and fun conversations", isPrivate: false, createdBy: createdUsers[0].id },
  ];

  const createdChannels: Channel[] = [];
  for (const ch of seedChannels) {
    const channel = await storage.createChannel(ch);
    createdChannels.push(channel);
    for (const user of createdUsers) {
      await storage.addChannelMember(channel.id, user.id);
    }
  }

  const seedMessages = [
    { content: "Welcome everyone to NexusComm! Our new private communication platform is now live.", channelId: createdChannels[0].id, fromUserId: createdUsers[0].id, type: "text" },
    { content: "Thanks Alex! This looks really polished. Love the dark mode.", channelId: createdChannels[0].id, fromUserId: createdUsers[1].id, type: "text" },
    { content: "The video calling feature works great! Just tested it with Tom.", channelId: createdChannels[0].id, fromUserId: createdUsers[2].id, type: "text" },
    { content: "Sprint planning is tomorrow at 10am. Please review the backlog.", channelId: createdChannels[1].id, fromUserId: createdUsers[1].id, type: "text" },
    { content: "New design system components are ready for review in Figma.", channelId: createdChannels[2].id, fromUserId: createdUsers[3].id, type: "text" },
    { content: "Q1 campaign metrics are in - 34% increase in engagement!", channelId: createdChannels[3].id, fromUserId: createdUsers[4].id, type: "text" },
    { content: "Anyone up for a virtual coffee break at 3pm? ☕", channelId: createdChannels[4].id, fromUserId: createdUsers[2].id, type: "text" },
    { content: "Count me in! See you all at 3.", channelId: createdChannels[4].id, fromUserId: createdUsers[3].id, type: "text" },
  ];

  for (const msg of seedMessages) {
    await storage.createMessage(msg as InsertMessage);
  }

  console.log("Database seeded successfully");
}
