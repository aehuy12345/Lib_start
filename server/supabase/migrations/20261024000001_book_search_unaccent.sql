-- 2.2.3 edge 3 [Giả định]: tìm sách theo tên/tác giả không phân biệt dấu tiếng Việt.
-- Hàm bọc chỉ định rõ schema + từ điển nên không phụ thuộc search_path của kết nối
-- (unaccent() gốc là STABLE vì đọc từ điển theo search_path).
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE FUNCTION public.immutable_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT SET search_path = '' AS $$
  SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;
