CREATE TABLE `replenish_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`factory_id` text,
	`excluded` integer DEFAULT false NOT NULL,
	`note` text,
	`updated_by_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replenish_plan_variant_id_unique` ON `replenish_plan` (`variant_id`);