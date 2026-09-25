PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_fabric_purchase_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`fabric_id` text,
	`draft_name` text,
	`meters_needed` real NOT NULL,
	`meters_ordered` real,
	`price_per_meter` real,
	`currency` text,
	`fx_rate_to_thb` real,
	`note` text,
	FOREIGN KEY (`purchase_id`) REFERENCES `fabric_purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fabric_id`) REFERENCES `fabrics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_fabric_purchase_lines`("id", "purchase_id", "fabric_id", "meters_needed", "meters_ordered", "note") SELECT "id", "purchase_id", "fabric_id", "meters_needed", "meters_ordered", "note" FROM `fabric_purchase_lines`;--> statement-breakpoint
DROP TABLE `fabric_purchase_lines`;--> statement-breakpoint
ALTER TABLE `__new_fabric_purchase_lines` RENAME TO `fabric_purchase_lines`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_fabrics` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text,
	`name` text NOT NULL,
	`composition` text,
	`color` text,
	`is_dyed` integer DEFAULT false NOT NULL,
	`roll_length_m` real,
	`width_cm` real,
	`purchase_price` real,
	`purchase_currency` text DEFAULT 'THB' NOT NULL,
	`fx_rate_to_thb` real DEFAULT 1 NOT NULL,
	`price_date` text,
	`supplier_id` text,
	`photo_url` text,
	`qr_token` text,
	`note` text,
	`is_on_order` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_fabrics`("id", "sku", "name", "composition", "color", "is_dyed", "roll_length_m", "width_cm", "purchase_price", "purchase_currency", "fx_rate_to_thb", "price_date", "supplier_id", "photo_url", "qr_token", "note", "is_on_order", "is_archived", "created_at", "updated_at") SELECT "id", "sku", "name", "composition", "color", "is_dyed", "roll_length_m", "width_cm", "purchase_price", "purchase_currency", "fx_rate_to_thb", "price_date", "supplier_id", "photo_url", "qr_token", "note", "is_on_order", "is_archived", "created_at", "updated_at" FROM `fabrics`;--> statement-breakpoint
DROP TABLE `fabrics`;--> statement-breakpoint
ALTER TABLE `__new_fabrics` RENAME TO `fabrics`;--> statement-breakpoint
CREATE UNIQUE INDEX `fabrics_sku_unique` ON `fabrics` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `fabrics_qr_token_unique` ON `fabrics` (`qr_token`);--> statement-breakpoint
CREATE INDEX `fabric_name_idx` ON `fabrics` (`name`);