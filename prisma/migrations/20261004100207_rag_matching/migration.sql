-- CreateEnum
CREATE TYPE "MatchFeedback" AS ENUM ('NONE', 'MINE', 'NOT_MINE', 'UNSURE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- DropIndex
DROP INDEX "posts_description_trgm_idx";

-- DropIndex
DROP INDEX "posts_location_trgm_idx";

-- DropIndex
DROP INDEX "posts_title_trgm_idx";

-- CreateTable
CREATE TABLE "post_embeddings" (
    "post_id" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[],
    "model" TEXT NOT NULL,
    "dim" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_embeddings_pkey" PRIMARY KEY ("post_id")
);

-- CreateTable
CREATE TABLE "embedding_tasks" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "embedding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "lost_post_id" TEXT NOT NULL,
    "found_post_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "detail" JSONB NOT NULL,
    "feedback" "MatchFeedback" NOT NULL DEFAULT 'NONE',
    "feedback_by_id" TEXT,
    "feedback_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "embedding_tasks_status_created_at_idx" ON "embedding_tasks"("status", "created_at");

-- CreateIndex
CREATE INDEX "matches_feedback_idx" ON "matches"("feedback");

-- CreateIndex
CREATE INDEX "matches_lost_post_id_idx" ON "matches"("lost_post_id");

-- CreateIndex
CREATE INDEX "matches_found_post_id_idx" ON "matches"("found_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "matches_lost_post_id_found_post_id_key" ON "matches"("lost_post_id", "found_post_id");

-- AddForeignKey
ALTER TABLE "post_embeddings" ADD CONSTRAINT "post_embeddings_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embedding_tasks" ADD CONSTRAINT "embedding_tasks_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_lost_post_id_fkey" FOREIGN KEY ("lost_post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_found_post_id_fkey" FOREIGN KEY ("found_post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_feedback_by_id_fkey" FOREIGN KEY ("feedback_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
