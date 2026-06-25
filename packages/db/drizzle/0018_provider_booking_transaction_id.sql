ALTER TABLE "provider_bookings" ADD COLUMN "provider_transaction_id" text;--> statement-breakpoint
DO $$
DECLARE
	duplicate_group_count integer;
BEGIN
	SELECT count(*) INTO duplicate_group_count
	FROM (
		SELECT "provider", "provider_reservation_id"
		FROM "provider_bookings"
		WHERE "provider_reservation_id" IS NOT NULL
			AND "external_account_id" IS NULL
		GROUP BY 1, 2
		HAVING count(*) > 1
	) duplicates;

	IF duplicate_group_count > 0 THEN
		RAISE EXCEPTION 'Cannot create provider_bookings_provider_reservation_null_account_uidx: % duplicate null-account provider reservation groups exist. Run the migration preflight query and resolve duplicates first.', duplicate_group_count;
	END IF;
END $$;--> statement-breakpoint
DROP INDEX "provider_bookings_provider_reservation_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "provider_bookings_provider_reservation_uidx" ON "provider_bookings" USING btree ("provider","external_account_id","provider_reservation_id") WHERE "provider_bookings"."provider_reservation_id" is not null and "provider_bookings"."external_account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_bookings_provider_reservation_null_account_uidx" ON "provider_bookings" USING btree ("provider","provider_reservation_id") WHERE "provider_bookings"."provider_reservation_id" is not null and "provider_bookings"."external_account_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_bookings_provider_transaction_uidx" ON "provider_bookings" USING btree ("provider","external_account_id","provider_transaction_id") WHERE "provider_bookings"."provider_transaction_id" is not null and "provider_bookings"."external_account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_bookings_provider_transaction_null_account_uidx" ON "provider_bookings" USING btree ("provider","provider_transaction_id") WHERE "provider_bookings"."provider_transaction_id" is not null and "provider_bookings"."external_account_id" is null;
