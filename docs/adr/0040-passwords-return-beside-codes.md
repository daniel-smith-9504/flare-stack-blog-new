# Passwords return beside codes

Supersedes [ADR 0030](./0030-sign-in-without-passwords.md).

A User may sign in with GitHub, with a Sign-in Code emailed to them, or with their email address and a password. Signing up, resetting a forgotten password and verifying an address stay off: the server gives every User a password instead. An Admin holds the one Admin password, which a migration sets and a new Admin is created with; every other User starts on the default password and keeps a banner asking them to change it until they do.

The owner wanted a password back: mail delivery is the one dependency that can lock every email User out of a site whose GitHub sign-in they may not have, and a password is what visitors expect from a login form. The default keeps the friction low for readers who only ever sign in once, and the banner holds the account to something better than a password every visitor of the blog knows.

## Considered Options

- **Passwords for new Users only.** Rejected: the Users already here are the readers who sign in rarely, and they need the fallback most.
- **A per-User random password mailed on first use.** Rejected: it needs working email delivery, which is the thing the password is there to survive.
- **Password sign-up and reset.** Rejected: both need email delivery, and neither is what the owner asked for.

## Consequences

Anyone who knows a User's email address can sign in as that User with the default password until the User changes it, so the banner is the only hold; the owner accepted that risk. The Admin password is one shared secret, so changing it changes nothing for an Admin — the banner never shows for one. Sign-in with a password is rate limited by IP as every other auth POST is, and the password hashes are stored as Better Auth writes them (scrypt, salted).
