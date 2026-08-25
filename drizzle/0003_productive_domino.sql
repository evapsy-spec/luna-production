CREATE TABLE `bot_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`title` text NOT NULL,
	`chat_type` text NOT NULL,
	`brand_name` text,
	`payer_name` text,
	`currency` text,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_chats_chat_id_unique` ON `bot_chats` (`chat_id`);--> statement-breakpoint
CREATE TABLE `bot_pending_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`requested_by_name` text NOT NULL,
	`action_type` text NOT NULL,
	`payload` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_name` text
);
--> statement-breakpoint
CREATE TABLE `bot_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`assigned_to_user_id` text,
	`assigned_to_name` text NOT NULL,
	`assigned_by_name` text NOT NULL,
	`description` text NOT NULL,
	`due_at` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`assigned_to_user_id`) REFERENCES `bot_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bot_tasks_status_idx` ON `bot_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `bot_tasks_assignee_idx` ON `bot_tasks` (`assigned_to_user_id`);--> statement-breakpoint
CREATE TABLE `bot_users` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_user_id` text NOT NULL,
	`telegram_username` text,
	`name` text NOT NULL,
	`sees_money` integer DEFAULT true NOT NULL,
	`can_confirm_money` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_users_telegram_user_id_unique` ON `bot_users` (`telegram_user_id`);