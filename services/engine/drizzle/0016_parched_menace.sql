CREATE TABLE `__new_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`title` text NOT NULL,
	`backend` text NOT NULL,
	`harness_session_id` text,
	`cwd` text NOT NULL,
	`worktree_path` text,
	`worktree_branch` text,
	`forked_from_job_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`forked_from_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sessions` (
	`id`, `uuid`, `title`, `backend`, `harness_session_id`, `cwd`,
	`worktree_path`, `worktree_branch`, `forked_from_job_id`, `created_at`
)
SELECT
	`session`.`id`,
	`session`.`uuid`,
	COALESCE(NULLIF((
		SELECT substr(
			trim(
				substr(
					ltrim(job.`prompt`, char(9) || char(10) || char(11) || char(12) || char(13) || char(32)),
					1,
					instr(ltrim(job.`prompt`, char(9) || char(10) || char(11) || char(12) || char(13) || char(32)) || char(10), char(10)) - 1
				),
				char(9) || char(10) || char(11) || char(12) || char(13) || char(32)
			),
			1,
			80
		)
		FROM `jobs` AS job
		WHERE job.`session_id` = `session`.`id`
		ORDER BY job.`id`
		LIMIT 1
	), ''), 'Untitled'),
	`session`.`backend`,
	`session`.`harness_session_id`,
	`session`.`cwd`,
	`session`.`worktree_path`,
	`session`.`worktree_branch`,
	`session`.`forked_from_job_id`,
	`session`.`created_at`
FROM `sessions` AS `session`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_uuid_uq` ON `sessions` (`uuid`);
