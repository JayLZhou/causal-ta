CREATE TABLE `study_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`course_id` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `study_checks_course` ON `study_checks` (`owner`,`course_id`);--> statement-breakpoint
CREATE TABLE `study_courses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`subject` text NOT NULL,
	`goal` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `study_courses_owner` ON `study_courses` (`owner`);--> statement-breakpoint
CREATE TABLE `study_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`chunks` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `study_documents_course` ON `study_documents` (`owner`,`course_id`);--> statement-breakpoint
CREATE TABLE `study_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`course_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`evidence` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `study_memories_course` ON `study_memories` (`owner`,`course_id`);--> statement-breakpoint
CREATE TABLE `study_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`course_id` text NOT NULL,
	`message` text NOT NULL,
	`reply` text NOT NULL,
	`sources` text NOT NULL,
	`memory` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `study_turns_course` ON `study_turns` (`owner`,`course_id`);