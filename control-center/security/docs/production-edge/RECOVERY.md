# Out-of-band recovery (self-service reset is disabled)

Authelia production config sets `authentication_backend.password_reset.disable: true`. There is no email reset, no in-app recovery code UI, and no public `/reset-password` flow.

## If the operator is locked out

1. A second human with host access generates a new `CC_OPERATOR_PASSWORD_HASH` using `security/production/secrets/generate-local.sh` targeting a gitignored directory (mode 0600, values not printed).
2. Replace the Authelia `users.yml` mount with the generated file.
3. Recreate the Authelia container (`compose up` of the productive project is a later human apply, not this campaign).
4. Confirm TOTP and WebAuthn/passkey enrollment again at `https://auth.ops.confenge.com.br`.
5. Destroy the previous hash file.

Do not re-enable self-service reset. Do not put hashes in git, tickets, or chat.

## Session / cookie

- Cookie domain: `ops.confenge.com.br`
- Secure (Authelia emits Secure because `authelia_url` is `https://auth.ops.confenge.com.br`)
- HttpOnly (Authelia always sets HttpOnly)
- SameSite=Lax
- `remember_me=false`
- inactivity 30 minutes, expiration 8 hours
