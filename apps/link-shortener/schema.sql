-- Link shortener: short codes made by the database, click counts counted by the database.
-- The page never writes the table: it calls two tracked functions, so a visitor can neither
-- choose a code nor overwrite someone else's link.
CREATE TABLE IF NOT EXISTS public.link_shortener_links (
  code text PRIMARY KEY CHECK (code ~ '^[0-9A-Za-z]{7}$'),
  target_url text NOT NULL CHECK (
    char_length(target_url) <= 2048
    AND target_url ~* '^https?://[^/?#[:space:]]+'
    AND target_url !~ '[[:space:][:cntrl:]]'
  ),
  clicks bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS link_shortener_links_created_idx
  ON public.link_shortener_links (created_at DESC);

-- 7 characters of base62 from a CSPRNG. gen_random_uuid() is built in (Postgres 13+); its bytes
-- 6 and 8 carry version bits, so only the other 14 are used, and bytes >= 248 are skipped so
-- every character is equally likely (248 = 4 * 62).
CREATE OR REPLACE FUNCTION public.link_shortener_new_code() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  random_bytes bytea;
  byte_value int;
  result text := '';
BEGIN
  WHILE char_length(result) < 7 LOOP
    random_bytes := uuid_send(gen_random_uuid());
    FOR i IN 0..15 LOOP
      CONTINUE WHEN i IN (6, 8);
      byte_value := get_byte(random_bytes, i);
      CONTINUE WHEN byte_value >= 248;
      result := result || substr(alphabet, byte_value % 62 + 1, 1);
      EXIT WHEN char_length(result) = 7;
    END LOOP;
  END LOOP;
  RETURN result;
END $$;

-- Creates a link for a URL. The rules the page also shows live here:
-- http/https only (so no javascript: or data:), at most 2048 characters, no user:password@,
-- never a link back to a short link (that would loop), and at most 30 new links a minute
-- for the whole app.
CREATE OR REPLACE FUNCTION public.link_shortener_create(url text) RETURNS public.link_shortener_links
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  target text := btrim(url);
  authority text;
  host text;
  created public.link_shortener_links;
BEGIN
  IF target IS NULL OR target = '' THEN
    RAISE EXCEPTION 'Enter a URL to shorten.';
  END IF;
  IF char_length(target) > 2048 THEN
    RAISE EXCEPTION 'That URL is longer than 2048 characters.';
  END IF;
  IF target !~* '^https?://' THEN
    RAISE EXCEPTION 'Only http:// and https:// URLs can be shortened.';
  END IF;
  IF target ~ '[[:space:][:cntrl:]]' THEN
    RAISE EXCEPTION 'A URL cannot contain spaces.';
  END IF;
  authority := substring(target FROM '^[A-Za-z]+://([^/?#]*)');
  IF authority IS NULL OR authority = '' THEN
    RAISE EXCEPTION 'That URL has no host.';
  END IF;
  IF position('@' IN authority) > 0 THEN
    RAISE EXCEPTION 'URLs with a user name or password cannot be shortened.';
  END IF;
  host := lower(regexp_replace(authority, ':[0-9]*$', ''));
  IF host IN ('api.excalibase.io', 'examples-jfp7kx46kb.apps.excalibase.io')
     OR target ~* '^https?://[^/?#]+/link-shortener/go' THEN
    RAISE EXCEPTION 'That is already a short link.';
  END IF;

  -- One creator at a time, so the per-minute count cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtext('public.link_shortener_create'));
  IF (SELECT count(*) FROM public.link_shortener_links
      WHERE created_at > now() - interval '1 minute') >= 30 THEN
    RAISE EXCEPTION 'Too many new links right now. Try again in a minute.';
  END IF;

  FOR attempt IN 1..5 LOOP
    INSERT INTO public.link_shortener_links (code, target_url)
    VALUES (public.link_shortener_new_code(), target)
    ON CONFLICT (code) DO NOTHING
    RETURNING * INTO created;
    IF created.code IS NOT NULL THEN
      RETURN created;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'Could not find a free code. Try again.';
END $$;

-- Counts one click and returns the link, in one statement: two visitors at the same moment
-- both count. Returns no row for an unknown code.
CREATE OR REPLACE FUNCTION public.link_shortener_hit(short_code text) RETURNS public.link_shortener_links
LANGUAGE sql VOLATILE AS $$
  UPDATE public.link_shortener_links
  SET clicks = clicks + 1
  WHERE code = short_code
  RETURNING *;
$$;
