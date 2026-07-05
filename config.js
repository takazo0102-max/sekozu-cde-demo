// タイル配信元。ローカルは "" (=serve.jsが配信)。
// R2公開配信に切替えるには R2_PUBLIC_BASE を設定して serve.js 起動、
// または本ファイルを直接 "https://<公開ドメイン>" に書き換える。
window.TILE_BASE = window.TILE_BASE || "";

// Supabase（設定すると db.js が有効化。未設定ならフロントはlocalStorageで動作）
window.SUPABASE_URL = window.SUPABASE_URL || "";
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "";
