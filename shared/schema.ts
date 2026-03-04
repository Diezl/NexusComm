import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name").notNull(),
  avatar: text("avatar"),
  role: text("role").notNull().default("employee"),
  department: text("department"),
  status: text("status").notNull().default("offline"),
  lastSeen: timestamp("last_seen").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const channels = pgTable("channels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  isPrivate: boolean("is_private").notNull().default(false),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const channelMembers = pgTable("channel_members", {
  channelId: varchar("channel_id").notNull().references(() => channels.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  joinedAt: timestamp("joined_at").defaultNow(),
});

export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  content: text("content"),
  channelId: varchar("channel_id").references(() => channels.id),
  toUserId: varchar("to_user_id").references(() => users.id),
  fromUserId: varchar("from_user_id").notNull().references(() => users.id),
  type: text("type").notNull().default("text"),
  fileName: text("file_name"),
  fileUrl: text("file_url"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const calls = pgTable("calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  initiatorId: varchar("initiator_id").notNull().references(() => users.id),
  participantId: varchar("participant_id").references(() => users.id),
  channelId: varchar("channel_id").references(() => channels.id),
  type: text("type").notNull().default("video"),
  status: text("status").notNull().default("ringing"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const mediaPlaylists = pgTable("media_playlists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  items: json("items").notNull().$type<MediaItemRecord[]>(),
  itemCount: integer("item_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export type MediaItemRecord = {
  id: string;
  url: string;
  name: string;
  type: "local" | "url";
  streamType?: string;
  group?: string;
  logo?: string;
};

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  section: text("section"),
  durationSeconds: integer("duration_seconds").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  displayName: true,
  avatar: true,
  role: true,
  department: true,
});

export const insertChannelSchema = createInsertSchema(channels).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type ChannelMember = typeof channelMembers.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export type ActivityLog = typeof activityLogs.$inferSelect;
export type MediaPlaylist = typeof mediaPlaylists.$inferSelect;

export type ActivitySummary = {
  userId: string;
  displayName: string;
  username: string;
  department: string | null;
  status: string;
  currentSection: string | null;
  lastLogin: Date | null;
  loginCount: number;
  totalOnlineSeconds: number;
  chatSeconds: number;
  dmSeconds: number;
  videoCallSeconds: number;
  audioCallSeconds: number;
  adminSeconds: number;
};

export type MessageWithUser = Message & {
  user: Pick<User, "id" | "displayName" | "avatar" | "username">;
};

export type ChannelWithMeta = Channel & {
  memberCount: number;
  lastMessage?: string;
};

export type UserPublic = Omit<User, "password">;
