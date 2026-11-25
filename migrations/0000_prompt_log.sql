CREATE TABLE `prompts` (
 `id` text PRIMARY KEY NOT NULL,
 `title` text NOT NULL,
 `meeting_type` text NOT NULL,
 `purpose` text NOT NULL,
 `owner` text NOT NULL,
 `department` text NOT NULL,
 `created_at` text NOT NULL,
 `created_by` text NOT NULL,
 `active_version_id` text
);
--> statement-breakpoint
CREATE TABLE `versions` (
 `id` text PRIMARY KEY NOT NULL,
 `prompt_id` text NOT NULL REFERENCES `prompts`(`id`),
 `number` integer NOT NULL,
 `filename` text NOT NULL,
 `content` text NOT NULL,
 `sha256` text NOT NULL,
 `changes` text NOT NULL,
 `reason` text NOT NULL,
 `outcome` text NOT NULL,
 `rationale` text NOT NULL,
 `created_at` text NOT NULL,
 `author_id` text NOT NULL,
 `author_name` text NOT NULL,
 `author_email` text NOT NULL,
 `approved_at` text,
 `approved_by` text,
 `approver_name` text,
 `effective_date` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_version_unique` ON `versions` (`prompt_id`,`number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_content_unique` ON `versions` (`prompt_id`,`sha256`);
--> statement-breakpoint
CREATE TABLE `events` (
 `id` text PRIMARY KEY NOT NULL,
 `prompt_id` text NOT NULL REFERENCES `prompts`(`id`),
 `version_id` text NOT NULL REFERENCES `versions`(`id`),
 `action` text NOT NULL,
 `occurred_at` text NOT NULL,
 `actor_id` text NOT NULL,
 `actor_name` text NOT NULL,
 `actor_email` text NOT NULL,
 `detail` text NOT NULL
);
