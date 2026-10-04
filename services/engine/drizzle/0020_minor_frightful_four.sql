ALTER TABLE `jobs` ADD `runner_pid` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `interrupted_at` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `resume_count` integer DEFAULT 0 NOT NULL;