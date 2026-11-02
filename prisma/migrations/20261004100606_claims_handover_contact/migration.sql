-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "claims" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "claimant_id" TEXT NOT NULL,
    "match_id" TEXT,
    "message" TEXT NOT NULL,
    "proof" TEXT NOT NULL,
    "contact_encrypted" TEXT NOT NULL,
    "contact_masked" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "review_note" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewer_role" TEXT,
    "escalate_at" TIMESTAMP(3) NOT NULL,
    "escalated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handovers" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "meet_at" TIMESTAMP(3),
    "meet_place" TEXT,
    "proposed_by_id" TEXT,
    "proposed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_grants" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "grantor_id" TEXT NOT NULL,
    "grantee_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "contact_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claims_status_escalate_at_idx" ON "claims"("status", "escalate_at");

-- CreateIndex
CREATE INDEX "claims_claimant_id_idx" ON "claims"("claimant_id");

-- CreateIndex
CREATE UNIQUE INDEX "claims_post_id_claimant_id_key" ON "claims"("post_id", "claimant_id");

-- CreateIndex
CREATE UNIQUE INDEX "handovers_claim_id_key" ON "handovers"("claim_id");

-- CreateIndex
CREATE INDEX "contact_grants_claim_id_idx" ON "contact_grants"("claim_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_grants_claim_id_grantor_id_key" ON "contact_grants"("claim_id", "grantor_id");

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_id_fkey" FOREIGN KEY ("claimant_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_grants" ADD CONSTRAINT "contact_grants_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_grants" ADD CONSTRAINT "contact_grants_grantor_id_fkey" FOREIGN KEY ("grantor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_grants" ADD CONSTRAINT "contact_grants_grantee_id_fkey" FOREIGN KEY ("grantee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
