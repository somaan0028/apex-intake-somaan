CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`doer_id` integer NOT NULL,
	`is_ai` integer DEFAULT false NOT NULL,
	`lead_id` integer,
	`user_id` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "activities_type_check" CHECK("activities"."type" in ('lead:stage_update', 'lead:claimed', 'lead:released', 'lead:assigned', 'lead:unassigned', 'lead:send_to_firm', 'lead:marked-not-duplicate', 'lead:deleted', 'user:added', 'user:deleted'))
);
--> statement-breakpoint
CREATE INDEX `activities_doer_created_idx` ON `activities` (`doer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activities_lead_id_idx` ON `activities` (`lead_id`);--> statement-breakpoint
CREATE INDEX `activities_created_at_idx` ON `activities` (`created_at`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_user_id_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
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
CREATE INDEX `chats_user_updated_idx` ON `chats` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'USER' NOT NULL,
	`password_hash` text NOT NULL,
	`avatar_path` text,
	`preferences` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('ADMIN', 'USER')),
	CONSTRAINT "users_preferences_json_check" CHECK(json_valid("users"."preferences"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`matter_id` text NOT NULL,
	`created_at` integer,
	`case_type` text,
	`stage` text DEFAULT 'NEW' NOT NULL,
	`assigned_to_id` integer,
	`filler_first_name` text,
	`filler_last_name` text,
	`filler_phone` text,
	`filler_email` text,
	`is_filling_for_someone_else` integer DEFAULT false NOT NULL,
	`injured_first_name` text,
	`injured_last_name` text,
	`injured_phone` text,
	`injured_email` text,
	`relationship_to_injured` text,
	`date_of_accident` integer,
	`state` text,
	`county` text,
	`postcode` text,
	`injury_details` text,
	`accident_details` text,
	`notes` text,
	`is_at_fault` integer,
	`has_attorney` integer,
	`has_received_settlement` integer,
	`source` text,
	`medium` text,
	`content` text,
	`ipaddress` text,
	`trustedform` text,
	`journaya` text,
	`dup_match_string` text,
	`dup_group_id` text,
	`brightwater_lead_id` text,
	`sent_to_firm_at` integer,
	FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "leads_relationship_check" CHECK("leads"."relationship_to_injured" in ('SPOUSE', 'PARENT', 'STEP_PARENT', 'CHILD', 'STEP_CHILD', 'SIBLING', 'GRANDPARENT', 'GRANDCHILD', 'AUNT_UNCLE', 'NIECE', 'NEPHEW', 'COUSIN', 'IN_LAW', 'FRIEND', 'COLLEAGUE', 'NEIGHBOR', 'OTHER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_matter_id_unique` ON `leads` (`matter_id`) WHERE "leads"."matter_id" <> '';--> statement-breakpoint
CREATE INDEX `leads_stage_idx` ON `leads` (`stage`);--> statement-breakpoint
CREATE INDEX `leads_assigned_to_idx` ON `leads` (`assigned_to_id`);--> statement-breakpoint
CREATE INDEX `leads_case_type_idx` ON `leads` (`case_type`);--> statement-breakpoint
CREATE INDEX `leads_filler_email_idx` ON `leads` (`filler_email`);--> statement-breakpoint
CREATE INDEX `leads_dup_group_id_idx` ON `leads` (`dup_group_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `lead_bookmarks` (
	`user_id` integer NOT NULL,
	`lead_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `lead_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lead_bookmarks_lead_id_idx` ON `lead_bookmarks` (`lead_id`);