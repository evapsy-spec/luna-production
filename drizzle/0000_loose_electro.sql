CREATE TABLE `accessories` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'шт' NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`stock_qty` real DEFAULT 0 NOT NULL,
	`photo_url` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accessories_sku_unique` ON `accessories` (`sku`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_name` text NOT NULL,
	`changes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `bom_accessory_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`accessory_id` text NOT NULL,
	`qty_per_unit` real NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accessory_id`) REFERENCES `accessories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bom_accessory_uq` ON `bom_accessory_lines` (`product_id`,`accessory_id`);--> statement-breakpoint
CREATE TABLE `bom_fabric_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`fabric_id` text NOT NULL,
	`meters_per_unit` real NOT NULL,
	`waste_pct` real DEFAULT 0 NOT NULL,
	`note` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fabric_id`) REFERENCES `fabrics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bom_fabric_uq` ON `bom_fabric_lines` (`product_id`,`fabric_id`);--> statement-breakpoint
CREATE TABLE `collection_launches` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`season` text NOT NULL,
	`target_on_sale_at` text NOT NULL,
	`lead_time_days` integer DEFAULT 45 NOT NULL,
	`production_start_by` text,
	`note` text,
	`is_done` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `launch_date_idx` ON `collection_launches` (`target_on_sale_at`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ainur_category_id` text,
	`description` text,
	`photo_url` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_ainur_category_id_unique` ON `collections` (`ainur_category_id`);--> statement-breakpoint
CREATE TABLE `defect_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`factory_id` text NOT NULL,
	`order_line_id` text,
	`quantity` integer NOT NULL,
	`amount` real NOT NULL,
	`reason` text,
	`applied_to_order_id` text,
	`applied_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `production_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_line_id`) REFERENCES `production_order_lines`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `defect_factory_idx` ON `defect_credits` (`factory_id`,`applied_to_order_id`);--> statement-breakpoint
CREATE TABLE `fabric_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`fabric_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`lot_code` text NOT NULL,
	`length_m` real NOT NULL,
	`remaining_m` real NOT NULL,
	`arrived_at` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`fabric_id`) REFERENCES `fabrics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fabric_lots_lot_code_unique` ON `fabric_lots` (`lot_code`);--> statement-breakpoint
CREATE TABLE `fabric_purchase_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`fabric_id` text NOT NULL,
	`meters_needed` real NOT NULL,
	`meters_ordered` real,
	`note` text,
	FOREIGN KEY (`purchase_id`) REFERENCES `fabric_purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fabric_id`) REFERENCES `fabrics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fabric_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`reason` text,
	`order_id` text,
	`supplier_id` text,
	`created_at` text NOT NULL,
	`sent_at` text,
	`received_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `production_orders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fabric_purchases_number_unique` ON `fabric_purchases` (`number`);--> statement-breakpoint
CREATE TABLE `fabric_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`fabric_id` text NOT NULL,
	`warehouse_id` text,
	`order_id` text NOT NULL,
	`meters` real NOT NULL,
	`released` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`fabric_id`) REFERENCES `fabrics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`order_id`) REFERENCES `production_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reservation_order_idx` ON `fabric_reservations` (`order_id`);--> statement-breakpoint
CREATE TABLE `fabric_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`fabric_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`on_hand_m` real DEFAULT 0 NOT NULL,
	`reserved_m` real DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`fabric_id`) REFERENCES `fabrics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fabric_stock_uq` ON `fabric_stock` (`fabric_id`,`warehouse_id`);--> statement-breakpoint
CREATE TABLE `fabrics` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
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
CREATE UNIQUE INDEX `fabrics_sku_unique` ON `fabrics` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `fabrics_qr_token_unique` ON `fabrics` (`qr_token`);--> statement-breakpoint
CREATE INDEX `fabric_name_idx` ON `fabrics` (`name`);--> statement-breakpoint
CREATE TABLE `factories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`specialization` text,
	`contact` text,
	`phone` text,
	`whatsapp` text,
	`email` text,
	`address` text,
	`maps_lat` real,
	`maps_lng` real,
	`maps_url` text,
	`country` text,
	`note` text,
	`monthly_capacity_units` integer,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `factory_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`collection_id` text NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `factory_collection_uq` ON `factory_collections` (`factory_id`,`collection_id`);--> statement-breakpoint
CREATE TABLE `factory_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`product_id` text NOT NULL,
	`price_per_unit` real NOT NULL,
	`valid_from` text NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `factory_price_idx` ON `factory_prices` (`factory_id`,`product_id`,`is_current`);--> statement-breakpoint
CREATE TABLE `order_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`kind` text DEFAULT 'DEPOSIT' NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'THB' NOT NULL,
	`paid_at` text NOT NULL,
	`invoice_no` text,
	`note` text,
	FOREIGN KEY (`order_id`) REFERENCES `production_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pattern_files` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_url` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`version` text,
	`uploaded_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`sku` text NOT NULL,
	`color` text,
	`size` text,
	`ainur_id` text,
	`ainur_name` text,
	`price` real,
	`qr_token` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_sku_unique` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_ainur_id_unique` ON `product_variants` (`ainur_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_qr_token_unique` ON `product_variants` (`qr_token`);--> statement-breakpoint
CREATE INDEX `variant_product_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE TABLE `production_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`size` text,
	`quantity` integer NOT NULL,
	`unit_sewing_cost` real DEFAULT 0 NOT NULL,
	`unit_fabric_cost` real DEFAULT 0 NOT NULL,
	`planned_ready_at` text,
	`qty_produced` integer DEFAULT 0 NOT NULL,
	`qty_defect` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `production_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `order_line_idx` ON `production_order_lines` (`order_id`);--> statement-breakpoint
CREATE TABLE `production_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`factory_id` text NOT NULL,
	`status` text DEFAULT 'SAMPLE' NOT NULL,
	`sample_requested_at` text,
	`sample_approved_at` text,
	`sample_note` text,
	`planned_ready_at` text,
	`actual_ready_at` text,
	`horizon_months` integer,
	`snapshot_fabric_cost` real DEFAULT 0 NOT NULL,
	`snapshot_accessory_cost` real DEFAULT 0 NOT NULL,
	`snapshot_sewing_cost` real DEFAULT 0 NOT NULL,
	`snapshot_total_cost` real DEFAULT 0 NOT NULL,
	`snapshot_at` text NOT NULL,
	`applied_defect_credit` real DEFAULT 0 NOT NULL,
	`note` text,
	`created_by_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_orders_number_unique` ON `production_orders` (`number`);--> statement-breakpoint
CREATE INDEX `order_status_idx` ON `production_orders` (`status`);--> statement-breakpoint
CREATE INDEX `order_factory_idx` ON `production_orders` (`factory_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`name` text NOT NULL,
	`base_sku` text,
	`photo_url` text,
	`note` text,
	`default_sewing_cost` real,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_collection_idx` ON `products` (`collection_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`ainur_document_id` text,
	`variant_id` text,
	`from_warehouse_id` text,
	`to_warehouse_id` text,
	`quantity` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_movements_ainur_document_id_unique` ON `stock_movements` (`ainur_document_id`);--> statement-breakpoint
CREATE INDEX `movement_date_idx` ON `stock_movements` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `stock_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`taken_at` text NOT NULL,
	`scope` text NOT NULL,
	`ref_id` text,
	`quantity` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshot_idx` ON `stock_snapshots` (`scope`,`ref_id`,`taken_at`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact` text,
	`phone` text,
	`whatsapp` text,
	`email` text,
	`address` text,
	`maps_lat` real,
	`maps_lng` real,
	`maps_url` text,
	`country` text,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'RUNNING' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`items_read` integer DEFAULT 0 NOT NULL,
	`items_written` integer DEFAULT 0 NOT NULL,
	`range_from` text,
	`range_to` text,
	`error` text,
	`triggered_by` text
);
--> statement-breakpoint
CREATE INDEX `sync_kind_idx` ON `sync_runs` (`kind`,`started_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'MANAGER' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `variant_sales_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`warehouse_id` text,
	`day` text NOT NULL,
	`units` integer DEFAULT 0 NOT NULL,
	`revenue` real DEFAULT 0 NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_daily_uq` ON `variant_sales_daily` (`variant_id`,`warehouse_id`,`day`);--> statement-breakpoint
CREATE INDEX `sales_day_idx` ON `variant_sales_daily` (`day`);--> statement-breakpoint
CREATE TABLE `variant_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variant_stock_uq` ON `variant_stock` (`variant_id`,`warehouse_id`);--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'GOODS' NOT NULL,
	`ainur_id` text,
	`country` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warehouses_ainur_id_unique` ON `warehouses` (`ainur_id`);