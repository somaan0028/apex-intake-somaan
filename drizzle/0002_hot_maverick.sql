PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`doer_id` integer NOT NULL,
	`is_ai` integer DEFAULT false NOT NULL,
	`lead_id` integer,
	`user_id` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "activities_type_check" CHECK("__new_activities"."type" in ('lead:stage_update', 'lead:claimed', 'lead:released', 'lead:assigned', 'lead:unassigned', 'lead:send_to_firm', 'lead:marked-not-duplicate', 'lead:deleted', 'user:added', 'user:deleted'))
);
--> statement-breakpoint
INSERT INTO `__new_activities`("id", "type", "description", "doer_id", "is_ai", "lead_id", "user_id", "created_at") SELECT "id", "type", "description", "doer_id", "is_ai", "lead_id", "user_id", "created_at" FROM `activities`;--> statement-breakpoint
DROP TABLE `activities`;--> statement-breakpoint
ALTER TABLE `__new_activities` RENAME TO `activities`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `activities_doer_created_idx` ON `activities` (`doer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activities_lead_id_idx` ON `activities` (`lead_id`);--> statement-breakpoint
CREATE INDEX `activities_created_at_idx` ON `activities` (`created_at`);