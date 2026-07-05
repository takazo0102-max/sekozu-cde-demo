// Supabaseデータアクセス層。schema.sql のテーブルに対応。
// 使い方: <script type="module"> import { db } from "./db.js"
// 設定は config.js の window.SUPABASE_URL / window.SUPABASE_ANON_KEY。
// 未設定時は supabase-js を取りに行かず db.enabled=false（=デモ/ローカル動作）。
const URL = window.SUPABASE_URL, KEY = window.SUPABASE_ANON_KEY;
export const enabled = Boolean(URL && KEY);
let sb = null;
if (enabled) {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  sb = createClient(URL, KEY);
}

// ---- 認証 ----
export const auth = {
  client: sb,
  async user() { return enabled ? (await sb.auth.getUser()).data.user : null; },
  async signIn(email, password) { return sb.auth.signInWithPassword({ email, password }); },
  async signUp(email, password) { return sb.auth.signUp({ email, password }); },
  async signOut() { return sb.auth.signOut(); },
  onChange(cb) { return sb?.auth.onAuthStateChange((_e, s) => cb(s?.user || null)); },
};

// ---- プロジェクト / 図面 ----
export const db = {
  enabled,

  async listProjects() {
    const { data, error } = await sb.from("projects").select("id,name,created_at").order("created_at");
    if (error) throw error; return data;
  },

  // 施工図(ハブ)＋根拠図面をtypeで取得
  async listDrawings(projectId) {
    const { data, error } = await sb.from("drawings")
      .select("id,drawing_no,title,type,discipline,current_version_id")
      .eq("project_id", projectId).order("drawing_no");
    if (error) throw error; return data;
  },

  // ハブ施工図に紐づく根拠図面（設計図・製作図）
  async listLinks(fromDrawingId) {
    const { data, error } = await sb.from("drawing_links")
      .select("id,to_drawing_id,relation,overlay_transform")
      .eq("from_drawing_id", fromDrawingId);
    if (error) throw error; return data;
  },
  async saveOverlayTransform(linkId, transform) {
    const { error } = await sb.from("drawing_links").update({ overlay_transform: transform }).eq("id", linkId);
    if (error) throw error;
  },

  // ---- 赤入れ（markups: version単位） ----
  async listMarkups(versionId) {
    const { data, error } = await sb.from("markups")
      .select("id,geometry,body,status,author_id,created_at")
      .eq("version_id", versionId).order("created_at");
    if (error) throw error; return data;
  },
  async addMarkup(versionId, geometry, body) {
    const uid = (await auth.user())?.id;
    const { data, error } = await sb.from("markups")
      .insert({ version_id: versionId, geometry, body, author_id: uid, status: "未対応" })
      .select().single();
    if (error) throw error; return data;
  },
  async updateMarkup(id, patch) {
    const { error } = await sb.from("markups").update(patch).eq("id", id);
    if (error) throw error;
  },
  async deleteMarkup(id) {
    const { error } = await sb.from("markups").delete().eq("id", id);
    if (error) throw error;
  },

  // ---- 承認（approvals + approval_steps） ----
  async getApproval(versionId) {
    const { data: a, error } = await sb.from("approvals")
      .select("id,state,approval_steps(id,seq,approver_role,decision,comment,decided_at)")
      .eq("version_id", versionId).single();
    if (error) throw error;
    a.approval_steps.sort((x, y) => x.seq - y.seq);
    return a;
  },
  async decideStep(stepId, decision, comment) {
    const { error } = await sb.from("approval_steps")
      .update({ decision, comment: comment || null, decided_at: new Date().toISOString() })
      .eq("id", stepId);
    if (error) throw error;
  },
  async setApprovalState(approvalId, state) {
    const { error } = await sb.from("approvals").update({ state }).eq("id", approvalId);
    if (error) throw error;
  },
  async resetApproval(approvalId) {
    const { error: e1 } = await sb.from("approval_steps")
      .update({ decision: null, comment: null, decided_at: null }).eq("approval_id", approvalId);
    if (e1) throw e1;
    await this.setApprovalState(approvalId, "申請中");
  },

  // 図面番号→drawing行（ビューア解決用）
  async getDrawingByNo(projectId, drawingNo) {
    const { data, error } = await sb.from("drawings")
      .select("id,drawing_no,title,type,current_version_id")
      .eq("project_id", projectId).eq("drawing_no", drawingNo).single();
    if (error) throw error; return data;
  },
  async getTilesKey(versionId) {
    const { data, error } = await sb.from("rendition_assets")
      .select("r2_key").eq("version_id", versionId).eq("kind", "tiles").single();
    if (error) return null; return data?.r2_key || null;
  },
  async getVersion(versionId) {
    const { data, error } = await sb.from("drawing_versions")
      .select("id,rev,status,drawing_id").eq("id", versionId).single();
    if (error) throw error; return data;
  },
};
