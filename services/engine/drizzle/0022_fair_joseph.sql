CREATE TABLE `compaction_summary_chunk_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`compaction_id` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `compaction_update_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`compaction_id` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`error` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notice_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plan_removed_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plan_update_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`plan_type` text NOT NULL,
	`entries` text,
	`uri` text,
	`markdown` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_message_chunk_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`sender_session_id` text,
	`recipient_session_id` text,
	`content` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_message_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`sender_session_id` text,
	`recipient_session_id` text,
	`content` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `subagent_update_events` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`child_session_id` text NOT NULL,
	`title` text,
	`description` text,
	`capabilities` text,
	`state` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `tool_call_events` ADD `name` text;