CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'USER' NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('ADMIN', 'USER'))
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
	`is_at_fault` integer,
	`has_attorney` integer,
	`has_received_settlement` integer,
	`source` text,
	`ipaddress` text,
	`trustedform` text,
	`jornaya` text,
	`brightwater_lead_id` text,
	`sent_to_firm_at` integer,
	FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "leads_relationship_check" CHECK("leads"."relationship_to_injured" in ('SPOUSE', 'PARENT', 'STEP_PARENT', 'CHILD', 'STEP_CHILD', 'SIBLING', 'GRANDPARENT', 'GRANDCHILD', 'AUNT_UNCLE', 'NIECE', 'NEPHEW', 'COUSIN', 'IN_LAW', 'FRIEND', 'COLLEAGUE', 'NEIGHBOR', 'OTHER')),
	CONSTRAINT "leads_case_type_check" CHECK("leads"."case_type" in ('MVA', 'MASS_TORT', 'OTHER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_matter_id_unique` ON `leads` (`matter_id`);--> statement-breakpoint
CREATE INDEX `leads_stage_idx` ON `leads` (`stage`);--> statement-breakpoint
CREATE INDEX `leads_assigned_to_idx` ON `leads` (`assigned_to_id`);--> statement-breakpoint
CREATE INDEX `leads_case_type_idx` ON `leads` (`case_type`);--> statement-breakpoint
CREATE INDEX `leads_filler_email_idx` ON `leads` (`filler_email`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);