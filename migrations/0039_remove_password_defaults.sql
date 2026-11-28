-- Password sign-in is self-service: a User registers with a password they
-- choose, verifies the address and can reset it by email. The flag that asked
-- for a change of the server-assigned default password goes away, and so do
-- the default-password credentials it guarded.
-- rollback-safe: the flag only drove a prompt; deleting the default-password
-- credentials leaves GitHub, Sign-in Codes and self-chosen passwords intact.
ALTER TABLE `user` DROP COLUMN `must_change_password`;
--> statement-breakpoint
DELETE FROM `account` WHERE `provider_id` = 'credential';
--> statement-breakpoint
DELETE FROM `verification` WHERE `identifier` LIKE 'reset-password:%';
