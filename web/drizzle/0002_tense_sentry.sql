CREATE TABLE `inquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inquiries_owner` ON `inquiries` (`owner`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `inquiry_id` text;