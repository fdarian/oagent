CREATE TABLE `custom_harnesses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`binary` text NOT NULL,
	`args` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
