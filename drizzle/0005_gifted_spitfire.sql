CREATE TABLE `sample_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sample_categories_name_unique` ON `sample_categories` (`name`);--> statement-breakpoint
CREATE TABLE `sample_fabric_links` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`fabric_id` text,
	`name` text,
	`photo_url` text,
	`supplier_name` text,
	`composition` text,
	`color` text,
	`price` real,
	`currency` text,
	`width_cm` real,
	`moq` text,
	`code` text,
	`url` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `sample_models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fabric_id`) REFERENCES `fabrics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sample_fabric_model_idx` ON `sample_fabric_links` (`model_id`);--> statement-breakpoint
CREATE TABLE `sample_models` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category_id` text,
	`status` text DEFAULT 'IDEA' NOT NULL,
	`designer` text NOT NULL,
	`assignee` text NOT NULL,
	`factory_id` text,
	`current_task` text,
	`due_date` text,
	`drive_folder_url` text,
	`sketch_photo_url` text,
	`season_collection` text,
	`estimated_unit_cost_thb` real,
	`designer_approved_at` text,
	`final_approved_at` text,
	`dropped_at` text,
	`production_order_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `sample_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`production_order_id`) REFERENCES `production_orders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sample_status_idx` ON `sample_models` (`status`);--> statement-breakpoint
CREATE INDEX `sample_category_idx` ON `sample_models` (`category_id`);--> statement-breakpoint
CREATE INDEX `sample_factory_idx` ON `sample_models` (`factory_id`);--> statement-breakpoint
CREATE TABLE `sample_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`date` text NOT NULL,
	`photo_url` text,
	`comment` text,
	`sample_cost_thb` real,
	`shipping_cost_thb` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `sample_models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sample_version_model_idx` ON `sample_versions` (`model_id`);