CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('admin', 'user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`matter_id` text NOT NULL,
	`created_at` text,
	`campaign` text,
	`stage` text DEFAULT 'New' NOT NULL,
	`assigned_to_id` integer,
	`first_name` text,
	`last_name` text,
	`phone` text,
	`email` text,
	`filling_for` text,
	`injured_first_name` text,
	`injured_last_name` text,
	`injured_phone` text,
	`injured_email` text,
	`relationship_to_injured` text,
	`date_of_accident` text,
	`state` text,
	`county` text,
	`postcode` text,
	`how_were_you_hurt` text,
	`briefly_describe_accident` text,
	`were_you_at_fault` text,
	`do_you_have_an_attorney` text,
	`have_you_received_settlement` text,
	`source` text,
	`ipaddress` text,
	`trustedform` text,
	`jornaya` text,
	`brightwater_lead_id` text,
	`sent_to_firm_at` text,
	FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_matter_id_unique` ON `leads` (`matter_id`);--> statement-breakpoint
CREATE INDEX `leads_stage_idx` ON `leads` (`stage`);--> statement-breakpoint
CREATE INDEX `leads_assigned_to_idx` ON `leads` (`assigned_to_id`);--> statement-breakpoint
CREATE INDEX `leads_campaign_idx` ON `leads` (`campaign`);--> statement-breakpoint
CREATE INDEX `leads_email_idx` ON `leads` (`email`);