CREATE TABLE `other_brand_sales_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`warehouse_id` text,
	`day` text NOT NULL,
	`units` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `other_brand_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `other_brand_sales_daily_uq` ON `other_brand_sales_daily` (`variant_id`,`warehouse_id`,`day`);--> statement-breakpoint
CREATE INDEX `other_brand_sales_day_idx` ON `other_brand_sales_daily` (`day`);--> statement-breakpoint
CREATE TABLE `other_brand_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `other_brand_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `other_brand_stock_uq` ON `other_brand_stock` (`variant_id`,`warehouse_id`);--> statement-breakpoint
CREATE TABLE `other_brand_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`brand` text NOT NULL,
	`model_name` text NOT NULL,
	`sku` text NOT NULL,
	`color` text,
	`size` text,
	`ainur_id` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `other_brand_variants_sku_unique` ON `other_brand_variants` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `other_brand_variants_ainur_id_unique` ON `other_brand_variants` (`ainur_id`);--> statement-breakpoint
CREATE INDEX `other_brand_variant_brand_idx` ON `other_brand_variants` (`brand`);