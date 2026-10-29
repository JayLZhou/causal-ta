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
 references: text("references").notNull(), created: text("created").notNull(), inquiryId: text("inquiry_id"),
}, t => [index("conversations_owner").on(t.owner)]);
export const usage = sqliteTable("usage", {
 key: text("key").primaryKey(), count: integer("count").notNull(),
});
export const inquiries = sqliteTable('inquiries', {
 id: text('id').primaryKey(), owner: text('owner').notNull(), state: text('state').notNull(),
 revision: integer('revision').notNull().default(0), created: text('created').notNull(), updated: text('updated').notNull(),
}, t=>[index('inquiries_owner').on(t.owner)]);

export const studyCourses = sqliteTable('study_courses', {
 id:text('id').primaryKey(),owner:text('owner').notNull(),title:text('title').notNull(),subject:text('subject').notNull(),goal:text('goal').notNull(),created:text('created').notNull(),updated:text('updated').notNull(),
},t=>[index('study_courses_owner').on(t.owner)]);
export const studyDocuments = sqliteTable('study_documents', {
 id:text('id').primaryKey(),owner:text('owner').notNull(),courseId:text('course_id').notNull(),title:text('title').notNull(),body:text('body').notNull(),chunks:text('chunks').notNull(),created:text('created').notNull(),
},t=>[index('study_documents_course').on(t.owner,t.courseId)]);
export const studyTurns = sqliteTable('study_turns', {
 id:text('id').primaryKey(),owner:text('owner').notNull(),courseId:text('course_id').notNull(),message:text('message').notNull(),reply:text('reply').notNull(),sources:text('sources').notNull(),memory:text('memory').notNull(),created:text('created').notNull(),
},t=>[index('study_turns_course').on(t.owner,t.courseId)]);
export const studyMemories = sqliteTable('study_memories', {
 id:text('id').primaryKey(),owner:text('owner').notNull(),courseId:text('course_id').notNull(),kind:text('kind').notNull(),content:text('content').notNull(),evidence:text('evidence').notNull(),updated:text('updated').notNull(),
},t=>[index('study_memories_course').on(t.owner,t.courseId)]);
export const studyChecks = sqliteTable('study_checks', {
 id:text('id').primaryKey(),owner:text('owner').notNull(),courseId:text('course_id').notNull(),state:text('state').notNull(),revision:integer('revision').notNull().default(0),created:text('created').notNull(),
},t=>[index('study_checks_course').on(t.owner,t.courseId)]);
