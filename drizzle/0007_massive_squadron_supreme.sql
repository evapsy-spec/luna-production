CREATE TABLE `transfer_dismissals` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`route` text NOT NULL,
	`dismissed_by_id` text,
	`dismissed_at` text NOT NULL,
	FOREIGN KEY (`dismissed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_dismissals_uq` ON `transfer_dismissals` (`variant_id`,`route`);