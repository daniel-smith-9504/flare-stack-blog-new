# Passwords return as self-service

Supersedes [ADR 0030](./0030-sign-in-without-passwords.md).

A User may register with an email address, a nickname and a password of their
own, verify the address from the emailed link, and sign in with that password.
A forgotten password is reset from an emailed link, and the signed-in User can
change it from their profile. GitHub and the Sign-in Code remain as the other
ways in.

The server does not give anyone a password: the earlier attempt did, and a
shared default password that every visitor of the blog knows is not a
credential. Registration therefore needs working email delivery, so a site
without it offers GitHub and the Sign-in Code alone, as before.

## Consequences

A password is the one sign-in method that survives broken mail delivery, which
is what ADR 0030 gave up. Registration, verification and reset send mail, so
those paths are rate limited per address and behind Turnstile; password sign-in
keeps the IP limits the other auth POSTs have. Passwords are stored as Better
Auth writes them (scrypt, salted).
