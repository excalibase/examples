-- Feedback board: posts and one vote per browser per post.
-- Tables are prefixed with the app name so several examples can share one project.
DROP TABLE IF EXISTS public.feedback_votes;
DROP TABLE IF EXISTS public.feedback_posts;

CREATE TABLE public.feedback_posts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL DEFAULT 'idea'
              CHECK (kind IN ('bug', 'idea', 'question', 'other')),
  body        text NOT NULL
              CHECK (char_length(btrim(body)) BETWEEN 3 AND 1000),
  author_name text
              CHECK (author_name IS NULL OR char_length(author_name) <= 50),
  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'planned', 'done', 'wontfix')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_posts_created_at_idx ON public.feedback_posts (created_at DESC);

-- The composite primary key is what stops a browser voting twice for the same post.
CREATE TABLE public.feedback_votes (
  feedback_id bigint NOT NULL REFERENCES public.feedback_posts (id) ON DELETE CASCADE,
  voter_id    uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feedback_id, voter_id)
);
