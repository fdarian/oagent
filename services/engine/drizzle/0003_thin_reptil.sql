CREATE TABLE `model_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`backend` text NOT NULL,
	`model_id` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_aliases_name_uq` ON `model_aliases` (`name`);