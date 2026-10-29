-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "role" AS ENUM ('admin', 'coach', 'student');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('scheduled', 'cancelled', 'completed');

-- CreateEnum
CREATE TYPE "plan_kind" AS ENUM ('monthly', 'weekly', 'pack', 'single_class');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('pending_payment', 'active', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('booked', 'attended', 'no_show', 'cancelled_by_student', 'cancelled_by_studio');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('card', 'cash');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "allocation_kind" AS ENUM ('sale', 'refund');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('in_transit', 'paid', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "settlement_period_status" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "settlement_method" AS ENUM ('cash', 'transfer');

-- CreateEnum
CREATE TYPE "legal_document_kind" AS ENUM ('terms', 'privacy');

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "role" "role" NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "birth_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" SERIAL NOT NULL,
    "profile_id" UUID,
    "full_name" TEXT NOT NULL,
    "public_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "birth_date" DATE,
    "stripe_customer_id" TEXT,
    "registered_by_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_health" (
    "student_id" INTEGER NOT NULL,
    "weight_kg" DECIMAL(5,2),
    "height_cm" SMALLINT,
    "special_conditions" TEXT,
    "consent_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "student_health_pkey" PRIMARY KEY ("student_id")
);

-- CreateTable
CREATE TABLE "coaches" (
    "id" SERIAL NOT NULL,
    "profile_id" UUID NOT NULL,
    "bio" TEXT,
    "instagram" TEXT,
    "tiktok" TEXT,
    "photo_path" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "coaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_disciplines" (
    "coach_id" INTEGER NOT NULL,
    "discipline_id" INTEGER NOT NULL,

    CONSTRAINT "coach_disciplines_pkey" PRIMARY KEY ("coach_id","discipline_id")
);

-- CreateTable
CREATE TABLE "coach_certifications" (
    "id" SERIAL NOT NULL,
    "coach_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "file_path" TEXT,
    "issued_at" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disciplines" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "default_capacity" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "disciplines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "discipline_id" INTEGER NOT NULL,
    "coach_id" INTEGER NOT NULL,
    "capacity" SMALLINT NOT NULL,
    "duration_min" SMALLINT NOT NULL DEFAULT 60,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_schedules" (
    "id" SERIAL NOT NULL,
    "class_id" INTEGER NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" SERIAL NOT NULL,
    "class_id" INTEGER NOT NULL,
    "schedule_id" INTEGER,
    "coach_id" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "capacity" SMALLINT NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'scheduled',
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_closures" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "plan_kind" NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MXN',
    "credits" INTEGER,
    "duration_days" SMALLINT NOT NULL,
    "training_days" INTEGER[],
    "allows_auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "stripe_price_id" TEXT,
    "created_by_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_revenue_shares" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "discipline_id" INTEGER NOT NULL,
    "coach_id" INTEGER NOT NULL,
    "basis_points" INTEGER NOT NULL,

    CONSTRAINT "plan_revenue_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" SERIAL NOT NULL,
    "student_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'pending_payment',
    "credits_total" INTEGER,
    "price_paid_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MXN',
    "training_days" INTEGER[],
    "starts_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "class_session_id" INTEGER,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "stripe_subscription_id" TEXT,
    "renewed_from_id" INTEGER,
    "request_expires_at" TIMESTAMPTZ,
    "approved_by_id" INTEGER,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "membership_id" INTEGER NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'booked',
    "marked_by_id" INTEGER,
    "marked_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "student_id" INTEGER NOT NULL,
    "membership_id" INTEGER,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "gross_cents" INTEGER NOT NULL,
    "fee_cents" INTEGER NOT NULL DEFAULT 0,
    "net_cents" INTEGER NOT NULL,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'MXN',
    "stripe_payment_intent_id" TEXT,
    "stripe_charge_id" TEXT,
    "stripe_invoice_id" TEXT,
    "payout_id" INTEGER,
    "received_by_id" INTEGER,
    "paid_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" SERIAL NOT NULL,
    "payment_id" INTEGER NOT NULL,
    "coach_id" INTEGER NOT NULL,
    "discipline_id" INTEGER NOT NULL,
    "kind" "allocation_kind" NOT NULL DEFAULT 'sale',
    "amount_cents" INTEGER NOT NULL,
    "basis_points" INTEGER NOT NULL,
    "settlement_period_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_payouts" (
    "id" SERIAL NOT NULL,
    "stripe_payout_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MXN',
    "status" "payout_status" NOT NULL,
    "arrival_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stripe_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_periods" (
    "id" SERIAL NOT NULL,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "status" "settlement_period_status" NOT NULL DEFAULT 'open',
    "closed_at" TIMESTAMPTZ,
    "summary" JSONB,

    CONSTRAINT "settlement_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" SERIAL NOT NULL,
    "period_id" INTEGER NOT NULL,
    "from_coach_id" INTEGER NOT NULL,
    "to_coach_id" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "method" "settlement_method" NOT NULL,
    "paid_at" TIMESTAMPTZ NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_streaks" (
    "student_id" INTEGER NOT NULL,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "best_streak" INTEGER NOT NULL DEFAULT 0,
    "last_attended_on" DATE,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "student_streaks_pkey" PRIMARY KEY ("student_id")
);

-- CreateTable
CREATE TABLE "leaderboard_entries" (
    "id" SERIAL NOT NULL,
    "month" DATE NOT NULL,
    "student_id" INTEGER NOT NULL,
    "days_attended" SMALLINT NOT NULL,
    "position" SMALLINT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leaderboard_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "studio_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" SERIAL NOT NULL,
    "kind" "legal_document_kind" NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_acceptances" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "students_profile_id_key" ON "students"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_stripe_customer_id_key" ON "students"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "students_registered_by_id_idx" ON "students"("registered_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "coaches_profile_id_key" ON "coaches"("profile_id");

-- CreateIndex
CREATE INDEX "coach_disciplines_discipline_id_idx" ON "coach_disciplines"("discipline_id");

-- CreateIndex
CREATE INDEX "coach_certifications_coach_id_idx" ON "coach_certifications"("coach_id");

-- CreateIndex
CREATE UNIQUE INDEX "disciplines_name_key" ON "disciplines"("name");

-- CreateIndex
CREATE UNIQUE INDEX "disciplines_slug_key" ON "disciplines"("slug");

-- CreateIndex
CREATE INDEX "classes_discipline_id_idx" ON "classes"("discipline_id");

-- CreateIndex
CREATE INDEX "classes_coach_id_idx" ON "classes"("coach_id");

-- CreateIndex
CREATE INDEX "class_schedules_class_id_idx" ON "class_schedules"("class_id");

-- CreateIndex
CREATE INDEX "class_sessions_starts_at_idx" ON "class_sessions"("starts_at");

-- CreateIndex
CREATE INDEX "class_sessions_class_id_idx" ON "class_sessions"("class_id");

-- CreateIndex
CREATE INDEX "class_sessions_coach_id_idx" ON "class_sessions"("coach_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_sessions_schedule_id_starts_at_key" ON "class_sessions"("schedule_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "studio_closures_date_key" ON "studio_closures"("date");

-- CreateIndex
CREATE INDEX "plans_created_by_id_idx" ON "plans"("created_by_id");

-- CreateIndex
CREATE INDEX "plan_revenue_shares_discipline_id_idx" ON "plan_revenue_shares"("discipline_id");

-- CreateIndex
CREATE INDEX "plan_revenue_shares_coach_id_idx" ON "plan_revenue_shares"("coach_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_revenue_shares_plan_id_discipline_id_key" ON "plan_revenue_shares"("plan_id", "discipline_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_renewed_from_id_key" ON "memberships"("renewed_from_id");

-- CreateIndex
CREATE INDEX "memberships_student_id_status_idx" ON "memberships"("student_id", "status");

-- CreateIndex
CREATE INDEX "memberships_plan_id_idx" ON "memberships"("plan_id");

-- CreateIndex
CREATE INDEX "memberships_class_session_id_idx" ON "memberships"("class_session_id");

-- CreateIndex
CREATE INDEX "memberships_stripe_subscription_id_idx" ON "memberships"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "memberships_status_request_expires_at_idx" ON "memberships"("status", "request_expires_at");

-- CreateIndex
CREATE INDEX "bookings_student_id_idx" ON "bookings"("student_id");

-- CreateIndex
CREATE INDEX "bookings_membership_id_status_idx" ON "bookings"("membership_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_session_id_student_id_key" ON "bookings"("session_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_payment_intent_id_key" ON "payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_charge_id_key" ON "payments"("stripe_charge_id");

-- CreateIndex
CREATE INDEX "payments_student_id_idx" ON "payments"("student_id");

-- CreateIndex
CREATE INDEX "payments_membership_id_idx" ON "payments"("membership_id");

-- CreateIndex
CREATE INDEX "payments_payout_id_idx" ON "payments"("payout_id");

-- CreateIndex
CREATE INDEX "payments_method_paid_at_idx" ON "payments"("method", "paid_at");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_id_idx" ON "payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_coach_id_idx" ON "payment_allocations"("coach_id");

-- CreateIndex
CREATE INDEX "payment_allocations_discipline_id_idx" ON "payment_allocations"("discipline_id");

-- CreateIndex
CREATE INDEX "payment_allocations_settlement_period_id_idx" ON "payment_allocations"("settlement_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_payouts_stripe_payout_id_key" ON "stripe_payouts"("stripe_payout_id");

-- CreateIndex
CREATE INDEX "stripe_payouts_arrival_date_idx" ON "stripe_payouts"("arrival_date");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_periods_week_start_key" ON "settlement_periods"("week_start");

-- CreateIndex
CREATE INDEX "settlements_period_id_idx" ON "settlements"("period_id");

-- CreateIndex
CREATE INDEX "settlements_from_coach_id_idx" ON "settlements"("from_coach_id");

-- CreateIndex
CREATE INDEX "settlements_to_coach_id_idx" ON "settlements"("to_coach_id");

-- CreateIndex
CREATE INDEX "leaderboard_entries_month_position_idx" ON "leaderboard_entries"("month", "position");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_entries_month_student_id_key" ON "leaderboard_entries"("month", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_kind_version_key" ON "legal_documents"("kind", "version");

-- CreateIndex
CREATE INDEX "legal_acceptances_student_id_idx" ON "legal_acceptances"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_acceptances_document_id_student_id_key" ON "legal_acceptances"("document_id", "student_id");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_registered_by_id_fkey" FOREIGN KEY ("registered_by_id") REFERENCES "coaches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_health" ADD CONSTRAINT "student_health_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaches" ADD CONSTRAINT "coaches_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_disciplines" ADD CONSTRAINT "coach_disciplines_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_disciplines" ADD CONSTRAINT "coach_disciplines_discipline_id_fkey" FOREIGN KEY ("discipline_id") REFERENCES "disciplines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_certifications" ADD CONSTRAINT "coach_certifications_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_discipline_id_fkey" FOREIGN KEY ("discipline_id") REFERENCES "disciplines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "class_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "coaches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_revenue_shares" ADD CONSTRAINT "plan_revenue_shares_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_revenue_shares" ADD CONSTRAINT "plan_revenue_shares_discipline_id_fkey" FOREIGN KEY ("discipline_id") REFERENCES "disciplines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_revenue_shares" ADD CONSTRAINT "plan_revenue_shares_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_class_session_id_fkey" FOREIGN KEY ("class_session_id") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "coaches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_renewed_from_id_fkey" FOREIGN KEY ("renewed_from_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "coaches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "stripe_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "coaches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_discipline_id_fkey" FOREIGN KEY ("discipline_id") REFERENCES "disciplines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_settlement_period_id_fkey" FOREIGN KEY ("settlement_period_id") REFERENCES "settlement_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "settlement_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_coach_id_fkey" FOREIGN KEY ("from_coach_id") REFERENCES "coaches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_coach_id_fkey" FOREIGN KEY ("to_coach_id") REFERENCES "coaches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_streaks" ADD CONSTRAINT "student_streaks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════
-- Lo que Prisma no expresa
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Cada perfil es una cuenta de Supabase Auth: al borrar la cuenta se borra el perfil.
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_id_auth_users_fkey"
  FOREIGN KEY ("id") REFERENCES auth.users ("id") ON DELETE CASCADE;

-- 2. Reglas de validación
ALTER TABLE "disciplines"
  ADD CONSTRAINT "disciplines_default_capacity_check" CHECK ("default_capacity" > 0);

ALTER TABLE "classes"
  ADD CONSTRAINT "classes_capacity_check" CHECK ("capacity" > 0),
  ADD CONSTRAINT "classes_duration_min_check" CHECK ("duration_min" > 0);

ALTER TABLE "class_schedules"
  ADD CONSTRAINT "class_schedules_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
  ADD CONSTRAINT "class_schedules_valid_range_check" CHECK ("valid_until" IS NULL OR "valid_until" >= "valid_from");

ALTER TABLE "class_sessions"
  ADD CONSTRAINT "class_sessions_capacity_check" CHECK ("capacity" > 0),
  ADD CONSTRAINT "class_sessions_time_range_check" CHECK ("ends_at" > "starts_at");

ALTER TABLE "plans"
  ADD CONSTRAINT "plans_price_cents_check" CHECK ("price_cents" >= 0),
  ADD CONSTRAINT "plans_credits_check" CHECK ("credits" IS NULL OR "credits" > 0),
  ADD CONSTRAINT "plans_duration_days_check" CHECK ("duration_days" > 0),
  ADD CONSTRAINT "plans_training_days_check" CHECK ("training_days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);

ALTER TABLE "plan_revenue_shares"
  ADD CONSTRAINT "plan_revenue_shares_basis_points_check" CHECK ("basis_points" BETWEEN 1 AND 10000);

ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_price_paid_cents_check" CHECK ("price_paid_cents" >= 0),
  ADD CONSTRAINT "memberships_credits_total_check" CHECK ("credits_total" IS NULL OR "credits_total" > 0),
  ADD CONSTRAINT "memberships_training_days_check" CHECK ("training_days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_gross_cents_check" CHECK ("gross_cents" >= 0),
  ADD CONSTRAINT "payments_fee_cents_check" CHECK ("fee_cents" >= 0),
  ADD CONSTRAINT "payments_refunded_cents_check" CHECK ("refunded_cents" BETWEEN 0 AND "gross_cents");

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_basis_points_check" CHECK ("basis_points" BETWEEN 1 AND 10000);

ALTER TABLE "settlement_periods"
  ADD CONSTRAINT "settlement_periods_week_check" CHECK ("week_end" = "week_start" + 6);

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_amount_cents_check" CHECK ("amount_cents" > 0),
  ADD CONSTRAINT "settlements_different_coaches_check" CHECK ("from_coach_id" <> "to_coach_id");

ALTER TABLE "leaderboard_entries"
  ADD CONSTRAINT "leaderboard_entries_days_attended_check" CHECK ("days_attended" >= 0),
  ADD CONSTRAINT "leaderboard_entries_position_check" CHECK ("position" >= 1);

-- 3. Seguridad: el backend entra como postgres (dueño de las tablas). La API pública de
-- Supabase (roles anon y authenticated) no puede leer ni escribir nada.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 4. Datos iniciales
INSERT INTO "disciplines" ("name", "slug", "description", "default_capacity") VALUES
  ('Barre', 'barre', 'Barre & Sculpt y Barre Restore', 13),
  ('Trampolín', 'trampolin', 'Jump', 10);

INSERT INTO "studio_settings" ("key", "value", "description", "updated_at") VALUES
  ('timezone', '"America/Mexico_City"', 'Zona horaria del estudio', now()),
  ('refund_credit_on_no_show', 'true', 'Devolver el crédito aunque la alumna falte', now()),
  ('cash_request_days', '3', 'Días para pagar en efectivo antes de que venza la solicitud', now()),
  ('booking_opens', '{"weekday": 6, "time": "06:00"}', 'La semana siguiente se abre a reservas el sábado a esta hora', now()),
  ('sessions_weeks_ahead', '2', 'Semanas de sesiones que se generan por adelantado', now()),
  ('settlement_week_starts', '1', 'El corte semanal va de lunes (1) a domingo', now());
