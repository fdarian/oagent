CREATE TABLE `alias_preset_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`preset_id` integer NOT NULL,
	`name` text NOT NULL,
	`backend` text NOT NULL,
	`model_id` text NOT NULL,
	`reasoning_effort` text,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`preset_id`) REFERENCES `alias_presets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alias_preset_items_preset_name_uq` ON `alias_preset_items` (`preset_id`,`name`);--> statement-breakpoint
CREATE TABLE `alias_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alias_presets_uuid_uq` ON `alias_presets` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `alias_presets_name_uq` ON `alias_presets` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `alias_presets_active_uq` ON `alias_presets` (`active`) WHERE "alias_presets"."active" = 1;