ALTER TABLE `users` ADD `avatar_path` text;--> statement-breakpoint
ALTER TABLE `users` ADD `preferences` text DEFAULT '{}' NOT NULL;
