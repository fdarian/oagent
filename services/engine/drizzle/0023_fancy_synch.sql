ALTER TABLE `sessions` ADD `origin_cwd` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `sessions` SET `origin_cwd` = `cwd`;
