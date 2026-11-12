-- Pago con tarjeta (Stripe Checkout): estado mientras la alumna está en la página de pago
ALTER TYPE "membership_status" ADD VALUE 'awaiting_card' AFTER 'pending_payment';

ALTER TABLE "memberships" ADD COLUMN "stripe_checkout_id" TEXT;
CREATE UNIQUE INDEX "memberships_stripe_checkout_id_key" ON "memberships"("stripe_checkout_id");
