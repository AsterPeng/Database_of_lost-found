-- 校园智能失物招领平台（CLFP）数据库结构快照
-- 生成方式：pg_dump --schema-only --no-owner --no-privileges
-- 生成时间：2026-11-02
-- 说明：本文件是 P1 基线结构；P2 及之后的视图、函数、触发器、物化视图由后续迁移添加。
--
-- PostgreSQL database dump
--

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: ClaimStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ClaimStatus" AS ENUM (
    'PENDING',
    'ACCEPTED',
    'REJECTED',
    'CANCELLED'
);


--
-- Name: MatchFeedback; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MatchFeedback" AS ENUM (
    'NONE',
    'MINE',
    'NOT_MINE',
    'UNSURE'
);


--
-- Name: NotificationType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NotificationType" AS ENUM (
    'MATCH',
    'CLAIM_RECEIVED',
    'CLAIM_RESULT',
    'CLAIM_ESCALATED',
    'HANDOVER',
    'SYSTEM'
);


--
-- Name: PostStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PostStatus" AS ENUM (
    'OPEN',
    'RESOLVED',
    'CLOSED'
);


--
-- Name: PostType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PostType" AS ENUM (
    'LOST',
    'FOUND'
);


--
-- Name: ReportStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ReportStatus" AS ENUM (
    'PENDING',
    'RESOLVED',
    'REJECTED'
);


--
-- Name: Role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Role" AS ENUM (
    'USER',
    'ADMIN'
);


--
-- Name: TaskStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TaskStatus" AS ENUM (
    'PENDING',
    'DONE',
    'FAILED'
);


--
-- Name: UserStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."UserStatus" AS ENUM (
    'ACTIVE',
    'BANNED',
    'ARCHIVED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    published_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) without time zone,
    created_by_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: app_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_configs (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    operator_id text,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    detail jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claims (
    id text NOT NULL,
    post_id text NOT NULL,
    claimant_id text NOT NULL,
    match_id text,
    message text NOT NULL,
    proof text NOT NULL,
    contact_encrypted text NOT NULL,
    contact_masked text NOT NULL,
    status public."ClaimStatus" DEFAULT 'PENDING'::public."ClaimStatus" NOT NULL,
    review_note text,
    reviewed_by_id text,
    reviewed_at timestamp(3) without time zone,
    reviewer_role text,
    escalate_at timestamp(3) without time zone NOT NULL,
    escalated_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: contact_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_grants (
    id text NOT NULL,
    claim_id text NOT NULL,
    grantor_id text NOT NULL,
    grantee_id text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    revoked_at timestamp(3) without time zone
);


--
-- Name: embedding_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embedding_tasks (
    id text NOT NULL,
    post_id text NOT NULL,
    status public."TaskStatus" DEFAULT 'PENDING'::public."TaskStatus" NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    error text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: handovers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.handovers (
    id text NOT NULL,
    claim_id text NOT NULL,
    meet_at timestamp(3) without time zone,
    meet_place text,
    proposed_by_id text,
    proposed_at timestamp(3) without time zone,
    completed_at timestamp(3) without time zone,
    completed_by_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matches (
    id text NOT NULL,
    lost_post_id text NOT NULL,
    found_post_id text NOT NULL,
    score double precision NOT NULL,
    detail jsonb NOT NULL,
    feedback public."MatchFeedback" DEFAULT 'NONE'::public."MatchFeedback" NOT NULL,
    feedback_by_id text,
    feedback_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id text NOT NULL,
    in_app boolean DEFAULT true NOT NULL,
    email boolean DEFAULT false NOT NULL,
    quiet_enabled boolean DEFAULT true NOT NULL,
    quiet_start integer DEFAULT 22 NOT NULL,
    quiet_end integer DEFAULT 7 NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id text NOT NULL,
    user_id text NOT NULL,
    type public."NotificationType" NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    link text,
    deliver_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    read_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: post_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_embeddings (
    post_id text NOT NULL,
    vector double precision[],
    model text NOT NULL,
    dim integer NOT NULL,
    text text NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: post_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_images (
    id text NOT NULL,
    post_id text NOT NULL,
    path text NOT NULL,
    mime_type text NOT NULL,
    size integer NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posts (
    id text NOT NULL,
    author_id text NOT NULL,
    type public."PostType" NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    category_id text NOT NULL,
    location text NOT NULL,
    occurred_at timestamp(3) without time zone NOT NULL,
    status public."PostStatus" DEFAULT 'OPEN'::public."PostStatus" NOT NULL,
    resolved_at timestamp(3) without time zone,
    deleted_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    take_down_reason text,
    taken_down_at timestamp(3) without time zone,
    taken_down_by_id text,
    archived_at timestamp(3) without time zone
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id text NOT NULL,
    reporter_id text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    reason text NOT NULL,
    detail text,
    status public."ReportStatus" DEFAULT 'PENDING'::public."ReportStatus" NOT NULL,
    handled_by_id text,
    handled_at timestamp(3) without time zone,
    handle_note text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "userAgent" text,
    ip text
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    nickname text NOT NULL,
    real_name text,
    student_no text,
    department text,
    phone_encrypted text,
    phone_masked text,
    role public."Role" DEFAULT 'USER'::public."Role" NOT NULL,
    status public."UserStatus" DEFAULT 'ACTIVE'::public."UserStatus" NOT NULL,
    profile_completed boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: app_configs app_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_configs
    ADD CONSTRAINT app_configs_pkey PRIMARY KEY (key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: claims claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_pkey PRIMARY KEY (id);


--
-- Name: contact_grants contact_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_grants
    ADD CONSTRAINT contact_grants_pkey PRIMARY KEY (id);


--
-- Name: embedding_tasks embedding_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_tasks
    ADD CONSTRAINT embedding_tasks_pkey PRIMARY KEY (id);


--
-- Name: handovers handovers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handovers
    ADD CONSTRAINT handovers_pkey PRIMARY KEY (id);


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: post_embeddings post_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_embeddings
    ADD CONSTRAINT post_embeddings_pkey PRIMARY KEY (post_id);


--
-- Name: post_images post_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_images
    ADD CONSTRAINT post_images_pkey PRIMARY KEY (id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: announcements_published_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcements_published_at_idx ON public.announcements USING btree (published_at);


--
-- Name: audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at);


--
-- Name: audit_logs_target_type_target_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_target_type_target_id_idx ON public.audit_logs USING btree (target_type, target_id);


--
-- Name: categories_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX categories_name_key ON public.categories USING btree (name);


--
-- Name: claims_claimant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claims_claimant_id_idx ON public.claims USING btree (claimant_id);


--
-- Name: claims_post_id_claimant_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX claims_post_id_claimant_id_key ON public.claims USING btree (post_id, claimant_id);


--
-- Name: claims_status_escalate_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claims_status_escalate_at_idx ON public.claims USING btree (status, escalate_at);


--
-- Name: contact_grants_claim_id_grantor_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contact_grants_claim_id_grantor_id_key ON public.contact_grants USING btree (claim_id, grantor_id);


--
-- Name: contact_grants_claim_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_grants_claim_id_idx ON public.contact_grants USING btree (claim_id);


--
-- Name: embedding_tasks_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX embedding_tasks_status_created_at_idx ON public.embedding_tasks USING btree (status, created_at);


--
-- Name: handovers_claim_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX handovers_claim_id_key ON public.handovers USING btree (claim_id);


--
-- Name: matches_feedback_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_feedback_idx ON public.matches USING btree (feedback);


--
-- Name: matches_found_post_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_found_post_id_idx ON public.matches USING btree (found_post_id);


--
-- Name: matches_lost_post_id_found_post_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX matches_lost_post_id_found_post_id_key ON public.matches USING btree (lost_post_id, found_post_id);


--
-- Name: matches_lost_post_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_lost_post_id_idx ON public.matches USING btree (lost_post_id);


--
-- Name: notifications_user_id_deliver_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_id_deliver_at_idx ON public.notifications USING btree (user_id, deliver_at);


--
-- Name: notifications_user_id_read_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_id_read_at_idx ON public.notifications USING btree (user_id, read_at);


--
-- Name: post_images_post_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX post_images_post_id_idx ON public.post_images USING btree (post_id);


--
-- Name: posts_author_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_author_id_idx ON public.posts USING btree (author_id);


--
-- Name: posts_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_category_id_idx ON public.posts USING btree (category_id);


--
-- Name: posts_status_deleted_at_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_status_deleted_at_created_at_idx ON public.posts USING btree (status, deleted_at, created_at);


--
-- Name: posts_type_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posts_type_status_idx ON public.posts USING btree (type, status);


--
-- Name: reports_reporter_id_target_type_target_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reports_reporter_id_target_type_target_id_key ON public.reports USING btree (reporter_id, target_type, target_id);


--
-- Name: reports_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_status_created_at_idx ON public.reports USING btree (status, created_at);


--
-- Name: sessions_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sessions_token_hash_key ON public.sessions USING btree (token_hash);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: announcements announcements_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: claims claims_claimant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_claimant_id_fkey FOREIGN KEY (claimant_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: claims claims_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: claims claims_reviewed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_reviewed_by_id_fkey FOREIGN KEY (reviewed_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: contact_grants contact_grants_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_grants
    ADD CONSTRAINT contact_grants_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: contact_grants contact_grants_grantee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_grants
    ADD CONSTRAINT contact_grants_grantee_id_fkey FOREIGN KEY (grantee_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: contact_grants contact_grants_grantor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_grants
    ADD CONSTRAINT contact_grants_grantor_id_fkey FOREIGN KEY (grantor_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: embedding_tasks embedding_tasks_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedding_tasks
    ADD CONSTRAINT embedding_tasks_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: handovers handovers_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handovers
    ADD CONSTRAINT handovers_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: matches matches_feedback_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_feedback_by_id_fkey FOREIGN KEY (feedback_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: matches matches_found_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_found_post_id_fkey FOREIGN KEY (found_post_id) REFERENCES public.posts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: matches matches_lost_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_lost_post_id_fkey FOREIGN KEY (lost_post_id) REFERENCES public.posts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: post_embeddings post_embeddings_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_embeddings
    ADD CONSTRAINT post_embeddings_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: post_images post_images_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_images
    ADD CONSTRAINT post_images_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: posts posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: posts posts_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: posts posts_taken_down_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_taken_down_by_id_fkey FOREIGN KEY (taken_down_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reports reports_handled_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_handled_by_id_fkey FOREIGN KEY (handled_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reports reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

