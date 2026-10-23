-- Schema khởi tạo theo design/erd/erd.md (duyệt tạm 2026-10-23).
-- Áp qua Supabase MCP apply_migration, sau đó `npx prisma db pull` để sinh model.

-- Enum ---------------------------------------------------------------------
CREATE TYPE user_role      AS ENUM ('reader', 'librarian', 'admin');
CREATE TYPE user_status    AS ENUM ('pending', 'active', 'disabled');
CREATE TYPE borrow_status  AS ENUM ('pending', 'borrowing', 'returned', 'rejected', 'cancelled');
CREATE TYPE return_status  AS ENUM ('pending', 'confirmed', 'rejected', 'cancelled');
CREATE TYPE book_condition AS ENUM ('normal', 'damaged', 'lost');
CREATE TYPE fine_type      AS ENUM ('late', 'damaged', 'lost');
CREATE TYPE fine_status    AS ENUM ('unpaid', 'pending', 'paid', 'rejected');

-- updated_at tự cập nhật (prisma db pull không sinh @updatedAt) -------------
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- users --------------------------------------------------------------------
CREATE TABLE users (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email             varchar(255) NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash     varchar(255) NOT NULL,
  name              varchar(50)  NOT NULL,
  phone             varchar(15),
  address           varchar(255),
  avatar_path       varchar(255),
  role              user_role   NOT NULL DEFAULT 'reader',
  status            user_status NOT NULL DEFAULT 'pending',
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_verification_tokens (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(255) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verification_tokens_user_id_idx ON email_verification_tokens (user_id);

-- categories / books -------------------------------------------------------
CREATE TABLE categories (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       varchar(50) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX categories_name_active_key ON categories (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE books (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title              varchar(100) NOT NULL,
  author             varchar(100) NOT NULL,
  publish_year       smallint     NOT NULL CHECK (publish_year >= 1900),
  isbn               varchar(13),
  description        varchar(255) NOT NULL,
  category_id        integer NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  cover_path         varchar(255),
  total_quantity     integer NOT NULL,
  available_quantity integer NOT NULL,
  borrowed_quantity  integer NOT NULL DEFAULT 0,
  damaged_quantity   integer NOT NULL DEFAULT 0,
  borrow_count       integer NOT NULL DEFAULT 0 CHECK (borrow_count >= 0),
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CONSTRAINT books_quantities_non_negative
    CHECK (available_quantity >= 0 AND borrowed_quantity >= 0 AND damaged_quantity >= 0),
  CONSTRAINT books_quantities_sum
    CHECK (total_quantity = available_quantity + borrowed_quantity + damaged_quantity)
);
CREATE UNIQUE INDEX books_isbn_active_key ON books (isbn) WHERE isbn IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX books_category_id_idx ON books (category_id);

-- borrow_orders ------------------------------------------------------------
CREATE TABLE borrow_orders (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reader_id       integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  book_id         integer NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  status          borrow_status NOT NULL DEFAULT 'pending',
  requested_days  smallint NOT NULL DEFAULT 14 CHECK (requested_days BETWEEN 1 AND 30),
  processed_by    integer REFERENCES users(id) ON DELETE RESTRICT,
  processed_at    timestamptz,
  reject_reason   varchar(500),
  borrowed_at     timestamptz,
  due_date        date,
  extension_count smallint NOT NULL DEFAULT 0 CHECK (extension_count BETWEEN 0 AND 1),
  extended_at     timestamptz,
  returned_at     timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT borrow_orders_reject_reason_required
    CHECK (status <> 'rejected' OR reject_reason IS NOT NULL),
  CONSTRAINT borrow_orders_borrowed_fields_required
    CHECK (status NOT IN ('borrowing', 'returned') OR (borrowed_at IS NOT NULL AND due_date IS NOT NULL))
);
CREATE UNIQUE INDEX borrow_orders_active_reader_book_key
  ON borrow_orders (reader_id, book_id) WHERE status IN ('pending', 'borrowing');
CREATE INDEX borrow_orders_status_created_at_idx ON borrow_orders (status, created_at);
CREATE INDEX borrow_orders_reader_id_status_idx  ON borrow_orders (reader_id, status);
CREATE INDEX borrow_orders_book_id_status_idx    ON borrow_orders (book_id, status);
CREATE INDEX borrow_orders_status_due_date_idx   ON borrow_orders (status, due_date);
CREATE INDEX borrow_orders_processed_by_idx      ON borrow_orders (processed_by);

-- return_requests ----------------------------------------------------------
CREATE TABLE return_requests (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  borrow_order_id integer NOT NULL REFERENCES borrow_orders(id) ON DELETE RESTRICT,
  status          return_status NOT NULL DEFAULT 'pending',
  requested_by    integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  processed_by    integer REFERENCES users(id) ON DELETE RESTRICT,
  processed_at    timestamptz,
  condition       book_condition,
  condition_note  varchar(500),
  late_days       smallint CHECK (late_days >= 0),
  reject_reason   varchar(500),
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT return_requests_condition_required
    CHECK (status <> 'confirmed' OR condition IS NOT NULL),
  CONSTRAINT return_requests_condition_note_required
    CHECK (condition IS NULL OR condition = 'normal' OR condition_note IS NOT NULL),
  CONSTRAINT return_requests_reject_reason_required
    CHECK (status <> 'rejected' OR reject_reason IS NOT NULL)
);
CREATE UNIQUE INDEX return_requests_pending_key   ON return_requests (borrow_order_id) WHERE status = 'pending';
CREATE UNIQUE INDEX return_requests_confirmed_key ON return_requests (borrow_order_id) WHERE status = 'confirmed';
CREATE INDEX return_requests_status_created_at_idx ON return_requests (status, created_at);
CREATE INDEX return_requests_requested_by_idx      ON return_requests (requested_by);
CREATE INDEX return_requests_processed_by_idx      ON return_requests (processed_by);

-- fine_tiers / fine_tickets ------------------------------------------------
CREATE TABLE fine_tiers (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       varchar(25) NOT NULL,
  type       fine_type   NOT NULL,
  amount     integer     NOT NULL CHECK (amount BETWEEN 1 AND 999999999),
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fine_tiers_name_active_key ON fine_tiers (lower(name)) WHERE is_active;
CREATE INDEX fine_tiers_type_is_active_idx ON fine_tiers (type, is_active);

CREATE TABLE fine_tickets (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reader_id         integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  borrow_order_id   integer NOT NULL REFERENCES borrow_orders(id) ON DELETE RESTRICT,
  return_request_id integer NOT NULL REFERENCES return_requests(id) ON DELETE RESTRICT,
  fine_tier_id      integer NOT NULL REFERENCES fine_tiers(id) ON DELETE RESTRICT,
  type              fine_type   NOT NULL,
  tier_name         varchar(25) NOT NULL,
  amount            integer     NOT NULL CHECK (amount > 0),
  note              varchar(500),
  status            fine_status NOT NULL DEFAULT 'unpaid',
  issued_at         timestamptz NOT NULL DEFAULT now(),
  issued_by         integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at      timestamptz,
  receipt_path      varchar(255),
  confirmed_by      integer REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at      timestamptz,
  reject_reason     varchar(500),
  rejected_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fine_tickets_return_request_type_key UNIQUE (return_request_id, type),
  CONSTRAINT fine_tickets_reject_reason_required
    CHECK (status <> 'rejected' OR reject_reason IS NOT NULL)
);
CREATE INDEX fine_tickets_reader_id_status_idx     ON fine_tickets (reader_id, status);
CREATE INDEX fine_tickets_status_submitted_at_idx  ON fine_tickets (status, submitted_at);
CREATE INDEX fine_tickets_issued_at_idx            ON fine_tickets (issued_at);
CREATE INDEX fine_tickets_borrow_order_id_idx      ON fine_tickets (borrow_order_id);
CREATE INDEX fine_tickets_fine_tier_id_idx         ON fine_tickets (fine_tier_id);
CREATE INDEX fine_tickets_issued_by_idx            ON fine_tickets (issued_by);
CREATE INDEX fine_tickets_confirmed_by_idx         ON fine_tickets (confirmed_by);

-- audit_logs ---------------------------------------------------------------
CREATE TABLE audit_logs (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action      varchar(50) NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id   integer     NOT NULL,
  old_value   jsonb,
  new_value   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx           ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_actor_id_created_idx ON audit_logs (actor_id, created_at);

-- Trigger updated_at -------------------------------------------------------
CREATE TRIGGER users_set_updated_at           BEFORE UPDATE ON users           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER categories_set_updated_at      BEFORE UPDATE ON categories      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER books_set_updated_at           BEFORE UPDATE ON books           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER borrow_orders_set_updated_at   BEFORE UPDATE ON borrow_orders   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER return_requests_set_updated_at BEFORE UPDATE ON return_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER fine_tiers_set_updated_at      BEFORE UPDATE ON fine_tiers      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER fine_tickets_set_updated_at    BEFORE UPDATE ON fine_tickets    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: bật trên mọi bảng, không tạo policy (backend truy cập trực tiếp qua Prisma)
ALTER TABLE users                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories                ENABLE ROW LEVEL SECURITY;
ALTER TABLE books                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE borrow_orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_requests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fine_tiers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE fine_tickets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs                ENABLE ROW LEVEL SECURITY;

-- Storage bucket (quy tắc ở design/flows/README.md mục "Upload file") -------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('avatars',     'avatars',     true,  2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('book-covers', 'book-covers', true,  2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('receipts',    'receipts',    false, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']);
