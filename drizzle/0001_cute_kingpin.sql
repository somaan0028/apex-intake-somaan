ALTER TABLE `leads` ADD `dup_match_string` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `dup_group_id` text;--> statement-breakpoint
CREATE INDEX `leads_dup_group_id_idx` ON `leads` (`dup_group_id`);