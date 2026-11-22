-- Password sign-in returns beside GitHub and the Sign-in Code (ADR 0040).
-- Every existing User gets a credential account: an Admin the one Admin
-- password, everyone else the default password, which they are asked to
-- change. Users who already have a password keep it, and an Admin's password
-- is reset to the Admin one either way.
ALTER TABLE `user` ADD `must_change_password` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `user` SET `must_change_password` = true
WHERE coalesce(`role`, '') <> 'admin'
	AND NOT EXISTS (
		SELECT 1 FROM `account`
		WHERE `account`.`user_id` = `user`.`id` AND `account`.`provider_id` = 'credential'
	);
--> statement-breakpoint
INSERT INTO `account` (`id`, `account_id`, `provider_id`, `user_id`, `password`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `user`.`id`, 'credential', `user`.`id`,
	CASE WHEN `user`.`role` = 'admin'
		THEN '8ec9d9fe9d24b4fe77b692d213eee1e3:4c2c1ed810790ee5ecab7d812c4c08da32f875a34dbf139b033cc4c52c3ef19fa1f80d2bc285808f9afd0260629d78202f92b2af97c73a5ce0ba5bb09c6bbc4e'
		ELSE 'cd2a287b90a99279c5b1b0bbe16cb24c:75f00dca05c5ae7665f763f2b4a81bfab3189767fadf9666696f445ec4eeb777345c6b562efd75bd51267a31e194edb26aaece5c3a86947edecd15d6e371ca41'
	END,
	cast(unixepoch('subsecond') * 1000 as integer),
	cast(unixepoch('subsecond') * 1000 as integer)
FROM `user`
WHERE NOT EXISTS (
	SELECT 1 FROM `account`
	WHERE `account`.`user_id` = `user`.`id` AND `account`.`provider_id` = 'credential'
);
--> statement-breakpoint
UPDATE `account`
SET `password` = '8ec9d9fe9d24b4fe77b692d213eee1e3:4c2c1ed810790ee5ecab7d812c4c08da32f875a34dbf139b033cc4c52c3ef19fa1f80d2bc285808f9afd0260629d78202f92b2af97c73a5ce0ba5bb09c6bbc4e',
	`updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `provider_id` = 'credential'
	AND `user_id` IN (SELECT `id` FROM `user` WHERE `role` = 'admin');
