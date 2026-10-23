const { createClient } = require('@supabase/supabase-js');

// Supabase Storage dùng service role key, chỉ chạy ở server (client không upload thẳng).
// Client Supabase tạo lazily: thiếu key thì chỉ thao tác ghi/xóa lỗi, URL công khai vẫn ghép được.
function createSupabaseStorage({ url, serviceRoleKey }) {
  let client;

  function getClient() {
    if (!url || !serviceRoleKey) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY');
    if (!client) {
      client = createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    }
    return client;
  }

  return {
    async upload(bucket, path, buffer, contentType) {
      const { error } = await getClient().storage.from(bucket).upload(path, buffer, { contentType, upsert: false });
      if (error) throw error;
    },
    async remove(bucket, path) {
      const { error } = await getClient().storage.from(bucket).remove([path]);
      if (error) throw error;
    },
    // Bucket public: URL có dạng cố định nên không cần gọi API.
    publicUrl(bucket, path) {
      if (!path) return null;
      return `${url}/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
    },
  };
}

module.exports = { createSupabaseStorage };
