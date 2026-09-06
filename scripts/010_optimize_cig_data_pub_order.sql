-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
-- Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
-- Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

-- Composite index to support sorting by most recent tenders (data_pubblicazione DESC, id DESC)
CREATE INDEX IF NOT EXISTS idx_cig_data_pub_id_desc ON public.cig (data_pubblicazione DESC, id DESC);
