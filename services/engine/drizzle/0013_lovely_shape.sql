CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`backend` text NOT NULL,
	`harness_session_id` text,
	`cwd` text NOT NULL,
	`worktree_path` text,
	`worktree_branch` text,
	`mcp_session_id` text,
	`forked_from_job_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`forked_from_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_uuid_uq` ON `sessions` (`uuid`);--> statement-breakpoint
CREATE TEMP TABLE `__session_sources` (
	`source_job_id` integer PRIMARY KEY,
	`harness_session_id` text,
	`session_uuid` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__session_sources` (`source_job_id`, `harness_session_id`, `session_uuid`)
SELECT j.`id`, j.`session_id`, lower(
	substr(printf('%012x', j.`created_at`), 1, 8) || '-' ||
	substr(printf('%012x', j.`created_at`), 9, 4) || '-7' ||
	substr(hex(randomblob(2)), 2, 3) || '-' ||
	substr('89ab', (abs(random()) % 4) + 1, 1) ||
	substr(hex(randomblob(2)), 2, 3) || '-' || hex(randomblob(6))
)
FROM `jobs` j
WHERE j.`session_id` IS NULL OR NOT EXISTS (
	SELECT 1 FROM `jobs` earlier
	WHERE earlier.`session_id` = j.`session_id`
		AND (earlier.`created_at` < j.`created_at`
			OR (earlier.`created_at` = j.`created_at` AND earlier.`id` < j.`id`))
);--> statement-breakpoint
CREATE INDEX `__session_sources_harness_idx` ON `__session_sources` (`harness_session_id`);--> statement-breakpoint
INSERT INTO `sessions` (`uuid`, `backend`, `harness_session_id`, `cwd`, `worktree_path`, `worktree_branch`, `mcp_session_id`, `created_at`)
SELECT source.`session_uuid`, j.`backend`, source.`harness_session_id`, j.`cwd`, j.`worktree_path`, j.`worktree_branch`, j.`mcp_session_id`, j.`created_at`
FROM `__session_sources` source
JOIN `jobs` j ON j.`id` = source.`source_job_id`;--> statement-breakpoint
UPDATE `jobs` SET `status` = 'error', `error_message` = 'engine restarted while running', `terminated_at` = CAST(strftime('%s', 'now') AS integer) * 1000
WHERE `status` = 'running';--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`model` text,
	`agent_type` text,
	`created_at` integer NOT NULL,
	`terminated_at` integer,
	`session_id` integer NOT NULL,
	`harness_last_message_id` text,
	`text` text,
	`stop_reason` text,
	`error_message` text,
	`side_chat_id` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`side_chat_id`) REFERENCES `side_chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_jobs` ("id", "uuid", "status", "prompt", "model", "agent_type", "created_at", "terminated_at", "session_id", "harness_last_message_id", "text", "stop_reason", "error_message", "side_chat_id")
SELECT j."id", j."uuid", j."status", j."prompt", j."model", j."agent_type", j."created_at", j."terminated_at", s."id", NULL, j."text", j."stop_reason", j."error_message", j."side_chat_id"
FROM `jobs` j
JOIN `__session_sources` source ON
	(j.`session_id` IS NOT NULL AND source.`harness_session_id` = j.`session_id`)
	OR (j.`session_id` IS NULL AND source.`source_job_id` = j.`id`)
JOIN `sessions` s ON s.`uuid` = source.`session_uuid`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
DROP TABLE `__session_sources`;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_uuid_uq` ON `jobs` (`uuid`);--> statement-breakpoint
CREATE INDEX `jobs_status_created_at_idx` ON `jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_side_chat_created_at_idx` ON `jobs` (`side_chat_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_side_chat_running_uq` ON `jobs` (`side_chat_id`) WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_session_running_uq` ON `jobs` (`session_id`) WHERE "jobs"."status" = 'running';
