CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`message` text NOT NULL,
	`reply` text NOT NULL,
	`references` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversations_owner` ON `conversations` (`owner`);--> statement-breakpoint
CREATE TABLE `usage` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL
);
