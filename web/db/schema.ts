import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const sessions = sqliteTable("sessions", {
 id: text("id").primaryKey(), owner: text("owner").notNull(), course: text("course").notNull(),
 state: text("state").notNull(), revision: integer("revision").notNull().default(0),
 created: text("created").notNull(), updated: text("updated").notNull(),
}, t => [index("sessions_owner").on(t.owner)]);
export const notes = sqliteTable("notes", {
 id: text("id").primaryKey(), owner: text("owner").notNull(), title: text("title").notNull(),
 subject: text("subject").notNull(), body: text("body").notNull(), updated: text("updated").notNull(),
}, t => [index("notes_owner").on(t.owner)]);
export const profiles = sqliteTable("profiles", {
 owner: text("owner").primaryKey(), name: text("name").notNull(), goal: text("goal").notNull(),
});
export const conversations = sqliteTable("conversations", {
 id: text("id").primaryKey(), owner: text("owner").notNull(),
 message: text("message").notNull(), reply: text("reply").notNull(),
 references: text("references").notNull(), created: text("created").notNull(),
}, t => [index("conversations_owner").on(t.owner)]);
export const usage = sqliteTable("usage", {
 key: text("key").primaryKey(), count: integer("count").notNull(),
});
