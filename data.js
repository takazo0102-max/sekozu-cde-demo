// 永続化ファサード。db.enabled なら Supabase、なければ デモ(レジストリ)+localStorage。
// index.html はこのモジュール越しにだけデータへ触る。
import { db } from "./db.js";

const TILE_BASE = window.TILE_BASE || "";
const dziUrl = (id) => `${TILE_BASE}tiles/${id}/image.dzi`;
const keyUrl = (r2key) => `${TILE_BASE}/${r2key}`;
export const STATUS = ["未対応", "対応中", "解決"];
export const ROLES = ["協力会社", "施工図担当", "元請"];

// ---- デモ図面レジストリ（タイル生成済みは A-101 / 設計図のみ）----
const DEMO = {
  "A-101":     { tile: "a-101",      title: "1F平面詳細図",      rev: "Rev.C", status: "作業中",   overlay: { tile: "sekkei-101", label: "A-意匠101（設計図）" } },
  "A-意匠101":  { tile: "sekkei-101", title: "1F平面図(実施設計)", rev: "Rev.2", status: "提出承認済" },
  "A-102":     { tile: null,         title: "2F平面詳細図",      rev: "Rev.B", status: "社内確認" },
  "S-201":     { tile: null,         title: "伏図",             rev: "Rev.A", status: "提出承認済" },
  "M-301":     { tile: null,         title: "空調ダクト製作図",   rev: "Rev.A", status: "作業中" },
};
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem(k); },
};

async function fetchReg() { try { return await fetch("/api/drawings").then((r) => r.json()); } catch { return []; } }
const isCurrent = (e) => e.status !== "旧版";

// 図面の版一覧（新しい順）。current=現行版
export async function listVersions(no) {
  const reg = await fetchReg();
  const vs = reg.filter((x) => x.no === no);
  if (vs.length) return vs.map((e) => ({ rev: e.rev, status: e.status, current: isCurrent(e) }))
    .sort((a, b) => (a.current === b.current ? 0 : a.current ? -1 : 1));
  if (DEMO[no]) return [{ rev: DEMO[no].rev, status: DEMO[no].status, current: true }];
  return [];
}

// ============ 図面解決 ============ rev指定で特定版を開ける
export async function resolveDrawing(no, rev) {
  if (!db.enabled) {
    // アップ済み図面(レジストリ)を優先
    const reg = await fetchReg();
    const vs = reg.filter((x) => x.no === no);
    if (vs.length) {
      const e = (rev && vs.find((x) => x.rev === rev)) || vs.find(isCurrent) || vs[vs.length - 1];
      return { mode: "demo", no: e.no, title: e.title, rev: e.rev, status: e.status,
        baseTile: dziUrl(e.tileId), overlay: null, versionId: null, isOld: e.status === "旧版" };
    }
    const key = DEMO[no] ? no : "A-101";
    const d = DEMO[key];
    return {
      mode: "demo", no: key, title: d.title, rev: d.rev, status: d.status,
      baseTile: d.tile ? dziUrl(d.tile) : null,
      overlay: d.overlay ? { tile: dziUrl(d.overlay.tile), label: d.overlay.label, linkId: null, transform: null } : null,
      versionId: null,
    };
  }
  // ---- Supabase ----
  const projects = await db.listProjects();
  const pid = projects[0]?.id;
  const drawings = await db.listDrawings(pid);
  const byId = Object.fromEntries(drawings.map((d) => [d.id, d]));
  const d = drawings.find((x) => x.drawing_no === no) || drawings.find((x) => x.type === "施工図") || drawings[0];
  const ver = await db.getVersion(d.current_version_id);
  const baseKey = await db.getTilesKey(ver.id);
  let overlay = null;
  const links = await db.listLinks(d.id);
  const link = links.find((l) => l.relation === "根拠") || links[0];
  if (link) {
    const od = byId[link.to_drawing_id];
    const ok = od?.current_version_id ? await db.getTilesKey(od.current_version_id) : null;
    overlay = { tile: ok ? keyUrl(ok) : null, label: od ? `${od.drawing_no}（${od.type}）` : "", linkId: link.id, transform: link.overlay_transform };
  }
  return {
    mode: "db", no: d.drawing_no, title: d.title, rev: ver.rev, status: ver.status,
    baseTile: baseKey ? keyUrl(baseKey) : null, overlay, versionId: ver.id,
  };
}

// ============ 赤入れ ============ status は 0/1/2 で扱う
export const markups = {
  async list(ctx) {
    if (ctx.mode === "demo") return ls.get(`markups:${ctx.no}:${ctx.rev}`, []);
    const rows = await db.listMarkups(ctx.versionId);
    return rows.map((r) => ({ id: r.id, x: r.geometry.x, y: r.geometry.y, body: r.body, status: STATUS.indexOf(r.status) }));
  },
  async add(ctx, x, y, body) {
    if (ctx.mode === "demo") {
      const arr = ls.get(`markups:${ctx.no}:${ctx.rev}`, []);
      arr.push({ id: crypto.randomUUID(), x, y, body, status: 0 });
      ls.set(`markups:${ctx.no}:${ctx.rev}`, arr); return arr;
    }
    await db.addMarkup(ctx.versionId, { x, y }, body);
    return this.list(ctx);
  },
  async update(ctx, id, patch) {
    if (ctx.mode === "demo") {
      const arr = ls.get(`markups:${ctx.no}:${ctx.rev}`, []);
      const m = arr.find((x) => x.id === id); if (m) Object.assign(m, patch);
      ls.set(`markups:${ctx.no}:${ctx.rev}`, arr); return arr;
    }
    const dbPatch = { ...patch };
    if ("status" in patch) dbPatch.status = STATUS[patch.status];
    await db.updateMarkup(id, dbPatch); return this.list(ctx);
  },
  async remove(ctx, id) {
    if (ctx.mode === "demo") {
      const arr = ls.get(`markups:${ctx.no}:${ctx.rev}`, []).filter((x) => x.id !== id);
      ls.set(`markups:${ctx.no}:${ctx.rev}`, arr); return arr;
    }
    await db.deleteMarkup(id); return this.list(ctx);
  },
};

// ============ 位置合わせ ============
export const align = {
  async get(ctx) {
    if (!ctx.overlay) return null;
    if (ctx.mode === "demo") return ls.get(`align:${ctx.no}`, null);
    return ctx.overlay.transform || null;
  },
  async save(ctx, transform) {
    if (ctx.mode === "demo") return ls.set(`align:${ctx.no}`, transform);
    if (ctx.overlay?.linkId) await db.saveOverlayTransform(ctx.overlay.linkId, transform);
  },
  async reset(ctx) {
    if (ctx.mode === "demo") return ls.del(`align:${ctx.no}`);
    if (ctx.overlay?.linkId) await db.saveOverlayTransform(ctx.overlay.linkId, null);
  },
};

// ============ 承認 ============ 返す形: {id, state, steps:[{key,seq,role,decision,comment}]}
function demoDefaultApproval() {
  return { id: null, state: "申請中", steps: ROLES.map((r, i) => ({ key: i, seq: i + 1, role: r, decision: null, comment: "" })) };
}
export const approval = {
  async get(ctx) {
    if (ctx.mode === "demo") return ls.get(`approval:${ctx.no}:${ctx.rev}`, demoDefaultApproval());
    const a = await db.getApproval(ctx.versionId);
    return { id: a.id, state: a.state, steps: a.approval_steps.map((s) => ({ key: s.id, seq: s.seq, role: s.approver_role, decision: s.decision, comment: s.comment || "" })) };
  },
  async decide(ctx, appr, stepKey, decision, comment) {
    if (ctx.mode === "demo") {
      const s = appr.steps.find((x) => x.key === stepKey);
      s.decision = decision; s.comment = comment || "";
      appr.state = decision === "差戻し" ? "差戻し" : (appr.steps.every((x) => x.decision === "承認") ? "承認済" : appr.state);
      ls.set(`approval:${ctx.no}:${ctx.rev}`, appr); return appr;
    }
    await db.decideStep(stepKey, decision, comment);
    const fresh = await this.get(ctx);
    if (decision === "差戻し") { await db.setApprovalState(appr.id, "差戻し"); fresh.state = "差戻し"; }
    else if (fresh.steps.every((x) => x.decision === "承認")) { await db.setApprovalState(appr.id, "承認済"); fresh.state = "承認済"; }
    return fresh;
  },
  async resubmit(ctx, appr) {
    if (ctx.mode === "demo") { const a = demoDefaultApproval(); ls.set(`approval:${ctx.no}:${ctx.rev}`, a); return a; }
    await db.resetApproval(appr.id); return this.get(ctx);
  },
};
