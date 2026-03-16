-- 006_challenges.sql
-- Friends/connections system + 1v1 challenge feature

-- ─── Friendships ────────────────────────────────────────────────────────────

CREATE TABLE public.friendships (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID        NOT NULL,
  addressee_id  UUID        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT friendships_requester_id_fkey  FOREIGN KEY (requester_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT friendships_addressee_id_fkey  FOREIGN KEY (addressee_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT friendships_unique             UNIQUE (requester_id, addressee_id),
  CONSTRAINT friendships_valid_status       CHECK (status IN ('pending', 'accepted', 'declined')),
  CONSTRAINT friendships_no_self            CHECK (requester_id <> addressee_id)
);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- Users can see rows they are part of
CREATE POLICY "friendships_select"
  ON public.friendships FOR SELECT
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- Users can only send requests (insert as requester)
CREATE POLICY "friendships_insert"
  ON public.friendships FOR INSERT
  WITH CHECK (requester_id = auth.uid());

-- Addressee can accept/decline
CREATE POLICY "friendships_update"
  ON public.friendships FOR UPDATE
  USING (addressee_id = auth.uid());

-- ─── Challenges ─────────────────────────────────────────────────────────────

CREATE TABLE public.challenges (
  id                             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id                  UUID    NOT NULL,
  challenged_id                  UUID    NOT NULL,
  tournament_id                  UUID    NOT NULL,
  status                         TEXT    NOT NULL DEFAULT 'pending',
  challenger_points              INTEGER,
  challenged_points              INTEGER,
  challenger_predictions_count   INTEGER,
  challenged_predictions_count   INTEGER,
  winner_id                      UUID,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT challenges_challenger_id_fkey  FOREIGN KEY (challenger_id)  REFERENCES public.users(id)       ON DELETE CASCADE,
  CONSTRAINT challenges_challenged_id_fkey  FOREIGN KEY (challenged_id)  REFERENCES public.users(id)       ON DELETE CASCADE,
  CONSTRAINT challenges_tournament_id_fkey  FOREIGN KEY (tournament_id)  REFERENCES public.tournaments(id) ON DELETE CASCADE,
  CONSTRAINT challenges_winner_id_fkey      FOREIGN KEY (winner_id)      REFERENCES public.users(id),
  CONSTRAINT challenges_valid_status        CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'completed')),
  CONSTRAINT challenges_no_self             CHECK (challenger_id <> challenged_id)
);

ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;

-- Users can see challenges they are part of
CREATE POLICY "challenges_select"
  ON public.challenges FOR SELECT
  USING (challenger_id = auth.uid() OR challenged_id = auth.uid());

-- Users can create challenges as the challenger
CREATE POLICY "challenges_insert"
  ON public.challenges FOR INSERT
  WITH CHECK (challenger_id = auth.uid());

-- Challenged user can accept/decline; system (service role) can do anything
CREATE POLICY "challenges_update"
  ON public.challenges FOR UPDATE
  USING (challenged_id = auth.uid());
