-- Kanban: personal boards with cards in three columns, owned by signed-in end users.
-- Applied as two migrations: kanban_schema, then kanban_cards_touch_updated_at.

-- migration: kanban_schema
-- Tables are prefixed with the app name so several examples can share one project.
-- owner_id is the signed-in user's id (the userId claim of the end-user token); the
-- API permissions set it from the session on insert and filter every operation by it.
CREATE TABLE public.kanban_boards (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id   bigint NOT NULL,
  title      text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);
CREATE INDEX kanban_boards_owner_idx ON public.kanban_boards (owner_id, created_at);

CREATE TABLE public.kanban_cards (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id    bigint NOT NULL,
  owner_id    bigint NOT NULL,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  status      text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  position    double precision NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- A card can only sit on a board owned by the same user.
  FOREIGN KEY (board_id, owner_id) REFERENCES public.kanban_boards (id, owner_id) ON DELETE CASCADE
);
CREATE INDEX kanban_cards_board_idx ON public.kanban_cards (board_id, status, position);
CREATE INDEX kanban_cards_owner_idx ON public.kanban_cards (owner_id);

-- migration: kanban_cards_touch_updated_at
CREATE FUNCTION public.kanban_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER kanban_cards_touch_updated_at BEFORE UPDATE ON public.kanban_cards
  FOR EACH ROW EXECUTE FUNCTION public.kanban_touch_updated_at();
