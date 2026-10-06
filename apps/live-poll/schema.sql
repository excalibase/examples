-- Live poll: a question, its 2 to 6 options, and one vote per browser.
CREATE TABLE IF NOT EXISTS public.live_poll_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL CHECK (char_length(btrim(question)) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.live_poll_options (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  poll_id uuid NOT NULL REFERENCES public.live_poll_polls (id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 5), -- at most 6 options
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  UNIQUE (poll_id, position),
  UNIQUE (poll_id, id) -- target of the composite foreign key on votes
);

CREATE TABLE IF NOT EXISTS public.live_poll_votes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  poll_id uuid NOT NULL,
  option_id bigint NOT NULL,
  voter_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- the option must belong to the poll the vote is for
  FOREIGN KEY (poll_id, option_id) REFERENCES public.live_poll_options (poll_id, id) ON DELETE CASCADE,
  UNIQUE (poll_id, voter_id) -- one vote per browser per poll
);

CREATE INDEX IF NOT EXISTS live_poll_votes_option_idx ON public.live_poll_votes (option_id);

-- Options can only be added while the poll is being created, so nobody can
-- append choices to someone else's poll later.
CREATE OR REPLACE FUNCTION public.live_poll_options_only_at_creation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.live_poll_polls
    WHERE id = NEW.poll_id AND created_at > now() - interval '2 minutes'
  ) THEN
    RAISE EXCEPTION 'options can only be added when the poll is created';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS live_poll_options_only_at_creation ON public.live_poll_options;
CREATE TRIGGER live_poll_options_only_at_creation
  BEFORE INSERT ON public.live_poll_options
  FOR EACH ROW EXECUTE FUNCTION public.live_poll_options_only_at_creation();
