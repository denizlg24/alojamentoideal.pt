# Alojamento Ideal emails

Transactional email templates for Alojamento Ideal. Source templates live in
`emails/*.vue` and are built by Maizzle into responsive HTML and plaintext.

```bash
bun run build
```

Generated files:

- `dist/*.html`: rendered email HTML
- `dist/*.txt`: plaintext fallbacks
- `generated/templates.ts`: string exports consumed by application packages

## Branding

The templates use the public web logo at
`https://alojamentoideal.pt/alojamento-ideal-logo.png` so the logo can load from
real inboxes. Keep copy aligned with Alojamento Ideal as a single operator of
its own apartments and selected local activities, not a marketplace.

## Placeholder Contract

All placeholders are replaced by the sender before delivery. Keep placeholder
names stable unless every sender is updated at the same time.

### Verification

- `APP_NAME`: usually `Alojamento Ideal`
- `VERIFY_URL`: one-time email verification URL
- `CURRENT_YEAR`: four-digit year for the footer

### Password reset

- `APP_NAME`: usually `Alojamento Ideal`
- `RESET_URL`: one-time password reset URL
- `CURRENT_YEAR`: four-digit year for the footer

### Order confirmation

- `APP_NAME`: usually `Alojamento Ideal`
- `ORDER_NUMBER`: guest-facing reservation reference
- `ACCOMMODATION_TITLE`: apartment title
- `ACCOMMODATION_IMAGE`: absolute public image URL
- `CHECK_IN`: localized check-in date or date/time text
- `CHECK_OUT`: localized check-out date or date/time text
- `GUESTS`: guest count summary
- `TOTAL_PRICE`: formatted total paid, including currency
- `PAYMENT_METHOD`: user-facing payment method label
- `CARD_LAST_FOUR`: optional card suffix text, including leading space when set
- `CONTACT_EMAIL`: guest email used for the reservation
- `CONTACT_PHONE`: guest phone number used for the reservation
- `BILLING_ADDRESS`: billing address text
- `MANAGE_URL`: reservation management URL
- `CURRENT_YEAR`: four-digit year for the footer

### Order pending confirmation

Sent by the Stripe webhook or reservation reconciler when payment has settled
but the provider booking still needs one more confirmation pass.

- `APP_NAME`: usually `Alojamento Ideal`
- `ORDER_NUMBER`: guest-facing reservation reference
- `ACCOMMODATION_TITLE`: apartment title
- `ACCOMMODATION_IMAGE`: absolute public image URL
- `CHECK_IN`: localized check-in date or date/time text
- `CHECK_OUT`: localized check-out date or date/time text
- `GUESTS`: guest count summary
- `TOTAL_PRICE`: formatted total paid, including currency
- `PAYMENT_METHOD`: user-facing payment method label
- `CARD_LAST_FOUR`: optional card suffix text, including leading space when set
- `CONTACT_EMAIL`: guest email used for the reservation
- `CONTACT_PHONE`: guest phone number used for the reservation
- `BILLING_ADDRESS`: billing address text
- `MANAGE_URL`: reservation management URL
- `CURRENT_YEAR`: four-digit year for the footer

### Order could not confirm

- `APP_NAME`: usually `Alojamento Ideal`
- `GREETING`: pre-built greeting line, e.g. `Hi Ana,`
- `ORDER_NUMBER`: guest-facing reservation reference
- `REFUND_AMOUNT`: formatted refund amount, including currency
- `BROWSE_URL`: URL where the guest can start a fresh booking
- `CURRENT_YEAR`: four-digit year for the footer

### Order amount mismatch refund

- `APP_NAME`: usually `Alojamento Ideal`
- `GREETING`: pre-built greeting line, e.g. `Hi Ana,`
- `ORDER_NUMBER`: guest-facing reservation reference
- `REFUND_AMOUNT`: formatted refund amount, including currency
- `BROWSE_URL`: URL where the guest can start a fresh booking
- `CURRENT_YEAR`: four-digit year for the footer

### Order invite

- `APP_NAME`: usually `Alojamento Ideal`
- `ORDER_NUMBER`: guest-facing reservation reference
- `ACCOMMODATION_TITLE`: apartment title
- `INVITE_URL`: one-time booking access URL
- `EXPIRES_IN_HOURS`: whole hours until the invite lapses
- `CURRENT_YEAR`: four-digit year for the footer
