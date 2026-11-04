CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` text NOT NULL,
	`external_id` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`mentions` text,
	`model` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`cost_usd` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chat_messages_role_check" CHECK("chat_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE INDEX `chat_messages_chat_id_idx` ON `chat_messages` (`chat_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_external_id_unique` ON `chat_messages` (`chat_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`title` text DEFAULT 'New chat' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chats_user_updated_idx` ON `chats` (`user_id`,`updated_at`);