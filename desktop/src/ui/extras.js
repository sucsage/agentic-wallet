/* MilestonePay desktop: the website's features in the app. Each screen calls the website's own
 * API through the app (/app/web/…), signed by this computer's device key (server side:
 * web/src/lib/device-chain/bridge.ts). Globals used: S, $, esc, api, toast, busy, idle, money, when,
 * go, renderView, renderApp, load, TOKEN, showErr. */
"use strict";

/** The website's API for this user (JSON). path without /api/, e.g. "summary". */
async function web(method, path, body) {
  const res = await fetch(`/app/web/${path}`, {
    method,
    headers: { "x-app-token": TOKEN, ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error((j && j.error) || `The server answered ${res.status}`);
  return j;
}
/** Opens a website document or file (HTML, PDF, CSV) in a new browser tab, signed by the app. */
function openWeb(path) {
  window.open(`/app/web/${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(TOKEN)}`, "_blank", "noopener");
}
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "-");
/** A small form in the app's dialog; resolves with the FormData, or null when cancelled. */
function formDialog(title, html, submitLabel = "Save", note = "") {
  return new Promise((resolve) => {
    const dlg = $("#dlg"), form = $("#dlg-form");
    form.innerHTML = `<h2>${title}</h2>${note ? `<p class="hint">${note}</p>` : ""}${html}<div class="err" id="fe2"></div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="ok">${submitLabel}</button></div>`;
    dlg.showModal();
    form.onsubmit = (ev) => {
      if (ev.submitter?.value !== "ok") return resolve(null);
      ev.preventDefault();
      const fd = new FormData(form);
      dlg.close();
      resolve(fd);
    };
    dlg.addEventListener("cancel", () => resolve(null), { once: true });
  });
}
const act = async (fn, okText) => { try { const r = await fn(); if (okText) toast(okText); return r; } catch (e) { toast(e.message); return null; } };

// ---------------------------------------------------------------------------------------------
// Deal details: documents, files, guarantor, witness, offer decline / revision, split payment, parcel, website
// ---------------------------------------------------------------------------------------------

const DOCS = [["contract", "Contract"], ["request", "Payment request"], ["receipt", "Receipt"], ["tax", "Tax invoice"], ["claim", "Complaint"]];

async function loadDealDetail(id) {
  S.dealDetail = S.dealDetail || {};
  try {
    const [d, files] = await Promise.all([web("GET", `deals/${id}`), web("GET", `deals/${id}/attachments`).catch(() => ({ files: [] }))]);
    S.dealDetail[id] = { ...d, attachments: files.files || files || [] };
  } catch (e) { S.dealDetail[id] = { error: e.message }; }
}

function dealDetailHtml(id) {
  const d = (S.dealDetail || {})[id];
  if (!d) return `<div class="loading" style="margin-top:8px"><span class="spin"></span>Loading the deal's details…</div>`;
  if (d.error) return `<p class="hint">${esc(d.error)}</p>`;
  const mineG = (d.guarantors || []).find((g) => g.mine), mineW = (d.witnesses || []).find((w) => w.mine);
  const plan = d.paymentPlan;
  const parts = plan && (plan.parts || []);
  const sec = (title, body) => `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line-2)"><b>${title}</b>${body}</div>`;
  let h = "";
  h += sec("Documents", `<div class="row" style="margin-top:6px">${DOCS.map(([k, l]) => `<button data-doc="${id}" data-k="${k}">${l}</button>`).join("")}</div><div class="hint">Each opens a printable page in your browser (Print → Save as PDF).</div>`);
  if (d.status === "Proposed") {
    h += sec("The offer", `${d.offerExpiresAt ? `<div class="hint">Sign (accept) by ${fmtDate(d.offerExpiresAt)}, or it is withdrawn.</div>` : ""}
      ${d.declined === "them" ? `<div class="issue warn">The other side turned this offer down.</div>` : d.declined === "me" ? `<div class="hint">You turned this offer down.</div>` : ""}
      ${d.canAccept && d.declined !== "me" ? `<div class="row" style="margin-top:6px"><button class="danger" data-decline="${id}">Decline the offer</button>${d.role === "buyer" ? `<button data-revise="${id}">Ask for a revised offer</button>` : ""}</div>` : ""}`);
  }
  if (d.rules) h += sec("Rules", `<div class="hint" style="white-space:pre-wrap">${esc(d.rules)}</div>`);
  if ((d.notes || []).length) h += sec("Requests", d.notes.map((n) => `<div class="hint">${n.kind === "CHANGES" ? `Changes to milestone ${Number(n.index) + 1}` : n.kind === "REVISION" ? "Revised offer asked" : esc(n.kind)} · ${fmtDate(n.at)}: ${esc(n.text)}</div>`).join(""));
  if (parts && parts.length) {
    const nextDue = parts.find((p) => !p.paid);
    h += sec(`Split payment ${plan.status ? `<span class="chip">${esc(plan.status.toLowerCase())}</span>` : ""}`, `${parts.map((p, i) => `<div class="hint">Part ${i + 1}: ${esc(p.amount)} · due ${esc(p.due)} ${p.paid ? "✓ paid" : ""}</div>`).join("")}
      ${plan.payer && plan.id ? `<div class="row" style="margin-top:6px">${nextDue ? `<button class="primary" data-planpay="${esc(plan.id)}">Pay the next part (${esc(nextDue.amount)})</button>` : plan.status === "PAID" ? `<button class="primary" data-planlock="${esc(plan.id)}">Lock the deal now</button>` : ""}${plan.status === "ACTIVE" ? `<button class="danger" data-plancancel="${esc(plan.id)}">Cancel the plan</button>` : ""}</div>` : ""}`);
  }
  h += sec("Guarantors (ผู้ค้ำ)", `${(d.guarantors || []).map((g) => `<div class="hint">${g.mine ? "Yours" : "Theirs"}: <b>${esc(g.name)}</b> · ${esc(g.relation)} · ${esc(g.contact)}${g.amount ? ` · up to ${esc(g.amount)}` : ""}</div>`).join("") || `<div class="hint">None yet.${d.guarantorsRequired ? ` Required: ${esc(d.guarantorsRequired)}.` : ""}</div>`}
    <div class="row" style="margin-top:6px"><button data-guar="${id}">${mineG ? "Change my guarantor" : "Add my guarantor"}</button>${mineG ? `<button data-guarrm="${id}">Remove mine</button>` : ""}</div>`);
  h += sec("Witnesses (พยาน)", `${(d.witnesses || []).map((w) => `<div class="hint">${w.mine ? "Yours" : "Theirs"}: <b>${esc(w.name)}</b>${w.contact ? ` · ${esc(w.contact)}` : ""}</div>`).join("") || `<div class="hint">None yet.</div>`}
    <div class="row" style="margin-top:6px"><button data-wit="${id}">${mineW ? "Change my witness" : "Add my witness"}</button>${mineW ? `<button data-witrm="${id}">Remove mine</button>` : ""}</div>`);
  const files = d.attachments || [];
  h += sec("Files of the deal", `${files.map((f) => `<div class="row space"><span>📎 ${esc(f.name)} <span class="hint">${f.size ? Math.max(1, Math.round(f.size / 1024)) + " KB" : ""}</span></span><span class="row"><button data-attopen="${id}" data-f="${esc(f.id)}">Open</button>${f.mine !== false ? `<button data-attrm="${id}" data-f="${esc(f.id)}">Delete</button>` : ""}</span></div>`).join("") || `<div class="hint">No files yet.</div>`}
    <form data-attup="${id}" class="row" style="margin-top:6px"><input type="file" name="file" required style="flex:1"><button>Upload</button></form>`);
  const parcels = (d.milestones || []).filter((m) => m.delivers === "parcel");
  if (parcels.length) h += sec("Parcels", parcels.map((m) => `<div class="row space"><span class="hint">Milestone ${m.index + 1}: ${m.delivery && m.delivery.tracking ? `${esc(m.delivery.carrier || "")} ${esc(m.delivery.tracking)} · ${esc(m.delivery.parcelStatus || m.delivery.status || "")}` : "not sent yet"}</span>${m.delivery && m.delivery.tracking ? `<button data-track="${id}" data-i="${m.index}">Refresh tracking</button>` : ""}</div>`).join(""));
  const sites = (d.milestones || []).filter((m) => m.canMockup);
  if (sites.length) h += sec("Websites delivered", sites.map((m) => `<div class="row space"><span class="hint">Milestone ${m.index + 1}: ${esc((m.delivery && m.delivery.fileName) || "site.html")}</span><button data-site="${id}" data-i="${m.index}">Try it (sandboxed)</button></div>`).join(""));
  const downloads = (d.milestones || []).filter((m) => m.canDownload);
  if (downloads.length) h += sec("Delivered files", downloads.map((m) => `<div class="row space"><span class="hint">Milestone ${m.index + 1}: ${esc(m.delivery.fileName)}</span><button data-dl="${id}" data-i="${m.index}">Download</button></div>`).join(""));
  return h;
}

async function refreshDetail(id) { await loadDealDetail(id); renderView(); }

function wireDealDetails() {
  document.querySelectorAll("[data-details]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.details;
    S.dealOpen = S.dealOpen || {};
    S.dealOpen[id] = !S.dealOpen[id];
    renderView();
    if (S.dealOpen[id]) { await loadDealDetail(id); renderView(); }
  }));
  const on = (sel, fn) => document.querySelectorAll(sel).forEach((b) => (b.onclick = (ev) => fn(b, ev)));
  on("[data-doc]", (b) => openWeb(`deals/${b.dataset.doc}/document?type=${b.dataset.k}`));
  on("[data-decline]", async (b) => { if (!confirm("Decline this offer? The other side sees it.")) return; await act(() => web("POST", `deals/${b.dataset.decline}/decline`, {}), "Offer declined"); refreshDetail(b.dataset.decline); });
  on("[data-revise]", async (b) => {
    const fd = await formDialog("Ask for a revised offer", `<label>What should change?</label><textarea name="text" rows="4" minlength="5" maxlength="1000" required></textarea>`, "Send", "The seller withdraws this offer and sends a new one. Nothing is paid until you accept.");
    if (fd) { await act(() => web("POST", `deals/${b.dataset.revise}/notes`, { kind: "REVISION", text: fd.get("text") }), "Sent to the seller"); refreshDetail(b.dataset.revise); }
  });
  on("[data-guar]", async (b) => {
    const fd = await formDialog("My guarantor (ผู้ค้ำประกัน)", `<label>Name</label><input name="name" required minlength="2"><label>Phone or email</label><input name="contact" required minlength="5"><label>Relation to you</label><input name="relation" required minlength="2"><label>Amount guaranteed (optional)</label><input name="amount" type="number" min="1">`, "Save", "Never an ID card number.");
    if (fd) { await act(() => web("PUT", `deals/${b.dataset.guar}/guarantor`, { name: fd.get("name"), contact: fd.get("contact"), relation: fd.get("relation"), amount: fd.get("amount") ? Number(fd.get("amount")) : null }), "Guarantor saved"); refreshDetail(b.dataset.guar); }
  });
  on("[data-guarrm]", async (b) => { await act(() => web("DELETE", `deals/${b.dataset.guarrm}/guarantor`), "Removed"); refreshDetail(b.dataset.guarrm); });
  on("[data-wit]", async (b) => {
    const fd = await formDialog("My witness (พยาน)", `<label>Name</label><input name="name" required minlength="2"><label>Phone or email (optional)</label><input name="contact">`);
    if (fd) { await act(() => web("PUT", `deals/${b.dataset.wit}/witness`, { name: fd.get("name"), contact: fd.get("contact") || "" }), "Witness saved"); refreshDetail(b.dataset.wit); }
  });
  on("[data-witrm]", async (b) => { await act(() => web("DELETE", `deals/${b.dataset.witrm}/witness`), "Removed"); refreshDetail(b.dataset.witrm); });
  on("[data-attopen]", (b) => openWeb(`deals/${b.dataset.attopen}/attachments/${b.dataset.f}`));
  on("[data-attrm]", async (b) => { if (!confirm("Delete this file?")) return; await act(() => web("DELETE", `deals/${b.dataset.attrm}/attachments/${b.dataset.f}`), "Deleted"); refreshDetail(b.dataset.attrm); });
  document.querySelectorAll("[data-attup]").forEach((f) => (f.onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = f.querySelector("button"); busy(btn, "Uploading…");
    await act(() => web("POST", `deals/${f.dataset.attup}/attachments`, new FormData(f)), "Uploaded");
    refreshDetail(f.dataset.attup);
  }));
  on("[data-planpay]", async (b) => { if (!confirm("Pay the next part now from your wallet?")) return; busy(b, "Paying…"); await act(() => web("POST", `plans/${b.dataset.planpay}/pay`, {}), "Part paid"); refreshDealLists(); });
  on("[data-planlock]", async (b) => { busy(b, "Locking…"); await act(() => web("POST", `plans/${b.dataset.planlock}/pay`, { lock: true }), "Locked in escrow"); refreshDealLists(); });
  on("[data-plancancel]", async (b) => { if (!confirm("Cancel the split payment? What was paid comes back to you.")) return; await act(() => web("POST", `plans/${b.dataset.plancancel}/cancel`, {}), "Plan cancelled"); refreshDealLists(); });
  on("[data-track]", async (b) => { await act(() => web("POST", `deals/${b.dataset.track}/parcel`, { index: Number(b.dataset.i) }), "Tracking refreshed"); refreshDetail(b.dataset.track); });
  on("[data-site]", (b) => openWeb(`deals/${b.dataset.site}/site/${b.dataset.i}`));
  on("[data-dl]", (b) => openWeb(`deals/${b.dataset.dl}/files/${b.dataset.i}`));
}

/** "Save as template" on a preview (the same template the website keeps). */
async function saveTemplate(d) {
  const fd = await formDialog("Save as a template", `<label>Template name</label><input name="name" required maxlength="80" value="${esc(d.title)}">`, "Save", "Reuse this deal's terms later: ask the AI \"use my template …\".");
  if (!fd) return;
  await act(() => web("POST", "templates", {
    name: fd.get("name"), side: d.side, kind: d.kind || "HIRE", title: d.title, summary: d.summary || "",
    // The website's own conversion (components/mockup-live.tsx templateFromDraft).
    milestones: d.milestones.map((m) => ({
      name: m.name,
      amount: String(Number(m.amount)),
      delivery: ["file", "parcel", "note"].includes(m.delivery) ? m.delivery : m.hasFile ? "file" : "note",
      acceptance: m.acceptance || "",
      dueDays: m.due ? Math.max(0, Math.round((new Date(m.due).getTime() - new Date(d.createdAt).getTime()) / 86_400_000)) : null,
    })),
  }), "Template saved");
}

// ---------------------------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------------------------

const EXTRA_VIEWS = {
  approvals: {
    title: "Waiting for you",
    async load() { S.approvals = await web("GET", "approvals"); },
    render(m) {
      const a = S.approvals;
      const row = (t, sub, btn) => `<div class="req row space" style="border-bottom:1px solid var(--line-2);padding:8px 0"><div><b>${t}</b>${sub ? `<div class="hint">${sub}</div>` : ""}</div>${btn || ""}</div>`;
      m.innerHTML = `<div class="row space"><h1>Waiting for you</h1><button id="x-refresh">Refresh</button></div>${requestsBanner()}
        ${!a ? `<div class="card"><div class="loading"><span class="spin"></span>Loading…</div></div>` : `
        <div class="card" style="margin-bottom:12px"><h2>Deliveries to review</h2>${(a.reviews || []).map((r) => row(`D-${esc(r.dealId)} · ${esc(r.title)}`, "Approve, or ask for changes", `<button data-go="deals">Open Deals</button>`)).join("") || `<p class="hint">Nothing.</p>`}</div>
        <div class="card" style="margin-bottom:12px"><h2>Offers to you</h2>${(a.offers || []).map((o) => row(`D-${esc(o.dealId)} · ${esc(o.title)}`, `from ${esc(o.sellerLabel || "a seller")}`, `<button data-go="deals">Open Deals</button>`)).join("") || `<p class="hint">Nothing.</p>`}</div>
        <div class="card" style="margin-bottom:12px"><h2>Your work as a seller</h2>${(a.sellerTodo || []).map((t) => row(`D-${esc(t.dealId)} · ${esc(t.title)}`, t.step === "accept" ? "Accept the offer" : "Deliver", `<button data-go="deals">Open Deals</button>`)).join("") || `<p class="hint">Nothing.</p>`}</div>
        <div class="card" style="margin-bottom:12px"><h2>Group votes</h2>${(a.groupVotes || []).map((v) => row(esc(v.title), esc(v.group && v.group.name), `<button data-go="groups">Open Groups</button>`)).join("") || `<p class="hint">Nothing.</p>`}</div>
        <div class="card"><h2>Previews to confirm</h2>${(a.drafts || []).map((d) => row(esc(d.title), "", `<button data-go="deals">Open Deals</button>`)).join("") || `<p class="hint">Nothing.</p>`}</div>`}`;
      $("#x-refresh").onclick = () => { S.approvals = null; load(); };
      document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
      wireRequestButtons();
    },
  },

  summary: {
    title: "Summary",
    async load() {
      const y = S.sumYear || new Date().getFullYear();
      S.summary = await web("GET", `summary?from=${y}-01-01&to=${y + 1}-01-01`);
    },
    render(m) {
      const s = S.summary, y = S.sumYear || new Date().getFullYear();
      const t = (s && s.totals) || {};
      const cur = (s && s.currency) || "THB";
      m.innerHTML = `<div class="row space"><h1>Summary</h1><div class="row"><select id="x-year" style="width:auto">${[0, 1, 2].map((k) => new Date().getFullYear() - k).map((yy) => `<option ${yy === y ? "selected" : ""}>${yy}</option>`).join("")}</select><button id="x-csv">Export CSV</button></div></div>
        ${!s ? `<div class="card"><div class="loading"><span class="spin"></span>Loading…</div></div>` : `
        <div class="grid">${[["Income", t.income], ["Spent", t.spent], ["Refunds", t.refunds], ["Net", t.net]].map(([l, v]) => `<div class="card stat"><div class="hint">${l}</div><div class="v">${money(v || 0, cur)}</div></div>`).join("")}</div>
        ${s.tax ? `<div class="card" style="margin-bottom:12px"><h2>Tax estimate</h2><div class="grid" style="margin:0">${[["Income", s.tax.income], ["Taxable", s.tax.taxable], ["Estimated tax", s.tax.tax]].map(([l, v]) => `<div><div class="hint">${l}</div><b>${money(v || 0, cur)}</b></div>`).join("")}</div>${s.tax.vatWarning ? `<div class="issue warn">${esc(s.tax.vatWarning)}</div>` : ""}${(s.tax.notes || []).map((n) => `<div class="hint">${esc(n)}</div>`).join("")}</div>` : ""}
        <div class="card" style="margin-bottom:12px"><div class="row space"><h2 style="margin:0">AI explanation</h2><button id="x-ai">Explain with AI</button></div><div id="x-ai-out" class="md" style="margin-top:8px">${S.sumAi ? window.renderMarkdown(S.sumAi) : `<p class="hint">Only totals and your deal titles go to the AI.</p>`}</div></div>
        <div class="card"><h2>Deals</h2><table><thead><tr><th>Deal</th><th>Role</th><th>Status</th><th>Paid</th><th>Refunded</th><th>Locked</th></tr></thead><tbody>${(s.deals || []).map((d) => `<tr><td>D-${esc(d.id)} ${esc(d.title)}</td><td>${esc(d.role)}</td><td>${esc(d.status)}</td><td>${money(d.paid || 0, cur)}</td><td>${money(d.refunded || 0, cur)}</td><td>${money(d.locked || 0, cur)}</td></tr>`).join("")}</tbody></table></div>`}`;
      $("#x-year").onchange = (e) => { S.sumYear = Number(e.target.value); S.summary = null; S.sumAi = null; load(); };
      $("#x-csv").onclick = () => openWeb(`summary/export?from=${y}-01-01&to=${y + 1}-01-01`);
      const ai = $("#x-ai"); if (ai) ai.onclick = async () => { busy(ai, "Thinking…"); const r = await act(() => web("POST", "summary/ai", { from: `${y}-01-01`, to: `${y + 1}-01-01`, lang: S.lang || "th" })); S.sumAi = r && (r.text || r.explanation || r.reply); renderView(); };
    },
  },

  templates: {
    title: "Templates",
    async load() { S.templates = (await web("GET", "templates")).templates; },
    render(m) {
      const t = S.templates;
      m.innerHTML = `<div class="row space"><h1>Deal templates</h1></div><p class="hint">Save a preview as a template ("Save as template" on a preview), then ask the AI to reuse it.</p>
        ${!t ? `<div class="card"><div class="loading"><span class="spin"></span>Loading…</div></div>` : t.length ? t.map((x) => `<div class="card deal"><div class="row space"><div><b>${esc(x.name)}</b> <span class="hint">${x.side === "BUY" ? "buying" : "selling"} · ${esc(x.kind)} · used ${x.uses}×</span><div class="hint">${esc(x.title)} · total ${esc(x.total)}</div></div>
          <div class="row"><button class="primary" data-tuse="${esc(x.name)}">Use in AI chat</button><button data-tren="${esc(x.id)}" data-n="${esc(x.name)}">Rename</button><button class="danger" data-tdel="${esc(x.id)}">Delete</button></div></div>
          ${x.milestones.map((ms, i) => `<div class="hint">${i + 1}. ${esc(ms.name)} · ${esc(ms.amount)}</div>`).join("")}</div>`).join("") : `<div class="card hint">No templates yet.</div>`}`;
      document.querySelectorAll("[data-tuse]").forEach((b) => (b.onclick = () => { S.chatDraft = `Use my template "${b.dataset.tuse}" and draft it. `; go("chat"); }));
      document.querySelectorAll("[data-tren]").forEach((b) => (b.onclick = async () => { const fd = await formDialog("Rename the template", `<label>Name</label><input name="name" required maxlength="80" value="${esc(b.dataset.n)}">`); if (fd) { await act(() => web("PATCH", `templates/${b.dataset.tren}`, { name: fd.get("name") }), "Renamed"); S.templates = null; load(); } }));
      document.querySelectorAll("[data-tdel]").forEach((b) => (b.onclick = async () => { if (!confirm("Delete this template?")) return; await act(() => web("DELETE", `templates/${b.dataset.tdel}`), "Deleted"); S.templates = null; load(); }));
    },
  },

  posts: {
    title: "Open calls",
    async load() { const r = await web("GET", "posts"); S.posts = r.posts || r; },
    render(m) {
      const p = S.posts;
      m.innerHTML = `<div class="row space"><h1>Open calls</h1><button id="x-newpost" class="primary">New open call (AI)</button></div>
        <p class="hint">A public link where anyone can apply with a PDF portfolio. The AI ranks applicants; choosing one drafts their deal.</p>
        ${!p ? `<div class="card"><div class="loading"><span class="spin"></span>Loading…</div></div>` : p.length ? p.map((x) => `<div class="card deal"><div class="row space"><div><b>${esc(x.title)}</b> <span class="chip ${x.open ? "ok" : ""}">${x.open ? "open" : esc(String(x.status).toLowerCase())}</span><div class="hint">budget ${esc(x.budget)} · ${x.chosen}/${x.positions} chosen · closes ${fmtDate(x.closesAt)}</div></div>
          <div class="row"><button data-plink="${esc(x.slug)}">Copy link</button><button data-prank="${esc(x.id)}">AI: who fits best?</button>${x.open ? `<button class="danger" data-pclose="${esc(x.id)}">Close</button>` : ""}</div></div>
          ${(x.files || []).length ? `<div class="hint">Documents: ${x.files.map((f) => `<a href="#" data-pfile="${esc(f.id)}">${esc(f.name)}</a>`).join(", ")}</div>` : ""}
          <form data-pup="${esc(x.id)}" class="row" style="margin-top:6px"><input type="file" name="file" required style="flex:1"><button>Add a document for applicants</button></form>
          <table style="margin-top:8px"><thead><tr><th>Applicant</th><th>Price</th><th>AI</th><th></th></tr></thead><tbody>${(x.applications || []).map((a) => `<tr><td><b>${esc(a.name)}</b><div class="hint">${esc(a.contact)}${a.message ? ` · ${esc(a.message).slice(0, 140)}` : ""}</div>${(a.files || []).map((f) => `<a href="#" data-afile="${esc(f.id)}" data-slug="${esc(x.slug)}">📎 ${esc(f.name)}</a>`).join(" ")}</td><td>${a.price === null ? "-" : esc(a.price)}</td><td>${a.ai ? `<b>${a.ai.score}</b><div class="hint">${esc(a.ai.reason).slice(0, 160)}</div>` : "-"}</td><td>${a.chosenAt ? `<span class="chip ok">chosen</span>` : x.open ? `<button data-pchoose="${esc(x.id)}" data-a="${esc(a.id)}">Choose</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="hint">No applicants yet.</td></tr>`}</tbody></table></div>`).join("") : `<div class="card hint">No open calls yet.</div>`}`;
      $("#x-newpost").onclick = () => { S.chatDraft = "Create a public open call (link) for: "; go("chat"); };
      const origin = (S.info.device && S.info.device.server) || "";
      document.querySelectorAll("[data-plink]").forEach((b) => (b.onclick = () => navigator.clipboard.writeText(`${origin}/apply/${b.dataset.plink}`).then(() => toast("Link copied"), () => toast("Copy failed"))));
      document.querySelectorAll("[data-prank]").forEach((b) => (b.onclick = async () => { busy(b, "Ranking…"); await act(() => web("POST", `posts/${b.dataset.prank}/recommend`, {}), "Ranked"); S.posts = null; load(); }));
      document.querySelectorAll("[data-pclose]").forEach((b) => (b.onclick = async () => { if (!confirm("Close this open call?")) return; await act(() => web("POST", `posts/${b.dataset.pclose}/close`, {}), "Closed"); S.posts = null; load(); }));
      document.querySelectorAll("[data-pchoose]").forEach((b) => (b.onclick = async () => { if (!confirm("Choose this applicant? Their deal preview is drafted for you to confirm.")) return; busy(b, "…"); await act(() => web("POST", `posts/${b.dataset.pchoose}/choose`, { applicationId: b.dataset.a }), "Chosen: the preview is under Deals"); S.posts = null; load(); }));
      document.querySelectorAll("[data-pfile]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openWeb(`posts/files/${a.dataset.pfile}`); }));
      document.querySelectorAll("[data-afile]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openWeb(`apply/${a.dataset.slug}/files/${a.dataset.afile}`); }));
      document.querySelectorAll("[data-pup]").forEach((f) => (f.onsubmit = async (ev) => { ev.preventDefault(); busy(f.querySelector("button"), "Uploading…"); await act(() => web("POST", `posts/${f.dataset.pup}/files`, new FormData(f)), "Added"); S.posts = null; load(); }));
    },
  },

  policy: {
    title: "Policy & limits",
    async load() { S.policy = await web("GET", "policy"); },
    render(m) {
      const p = S.policy;
      const caps = (p && (p.session || p.caps || p.limits)) || {};
      const paused = p && (p.paused ?? (p.state && p.state.paused));
      const recips = (p && (p.recipients || (p.allowlist && p.allowlist.recipients))) || [];
      m.innerHTML = `<div class="row space"><h1>Policy & limits${S.info.acting ? ` · ${esc(S.info.acting.name)}` : ""}</h1><button id="x-refresh">Refresh</button></div>
        ${!p ? `<div class="card"><div class="loading"><span class="spin"></span>Loading…</div></div>` : `
        <div class="grid">
          <div class="card"><h2>Agent limits</h2><p class="hint">The AI may pay by itself only within these, and only payees on the list. More than that waits for you.${caps.remainingToday !== undefined ? ` Left today: <b>${esc(caps.remainingToday)}</b>.` : ""}</p>
            <form id="x-limits"><label>Per transaction (10,000–100,000)</label><input name="maxPerTx" type="number" min="10000" max="100000" step="0.01" value="${esc(caps.maxPerTx ?? caps.perTx ?? "")}" required><label>Per day</label><input name="dailyLimit" type="number" min="1" step="0.01" value="${esc(caps.dailyLimit ?? caps.perDay ?? "")}" required>
            <div class="row" style="margin-top:8px"><button class="primary">Save limits</button></div></form></div>
          <div class="card"><h2>Pause</h2><p class="hint">${paused ? "The wallet is paused: the AI can pay nothing." : "Anyone with access can pause; only the owner resumes."}</p>
            <button id="x-pause" class="${paused ? "primary" : "danger"}">${paused ? "Resume the wallet" : "Pause the wallet"}</button></div>
        </div>
        <div class="card"><h2>Allow transfer list (payees)</h2>${recips.length ? recips.map((r) => `<div class="row space" style="border-bottom:1px solid var(--line-2);padding:6px 0"><span><b>${esc(r.label || r.name || "")}</b> <span class="mono hint">${esc(r.address || r)}</span></span><button class="danger" data-rmrec="${esc(r.address || r)}">Remove</button></div>`).join("") : `<p class="hint">Nobody yet. Make a friend a payee under Friends.</p>`}</div>`}`;
      $("#x-refresh").onclick = () => { S.policy = null; load(); };
      const lf = $("#x-limits"); if (lf) lf.onsubmit = async (ev) => { ev.preventDefault(); const fd = new FormData(lf); await act(() => web("PUT", "policy/limits", { maxPerTx: Number(fd.get("maxPerTx")), dailyLimit: Number(fd.get("dailyLimit")) }), "Limits saved"); S.policy = null; load(); };
      const pb = $("#x-pause"); if (pb) pb.onclick = async () => { if (!confirm(paused ? "Resume the wallet?" : "Pause the wallet? The AI can pay nothing until you resume.")) return; await act(() => web("POST", "policy/pause", { paused: !paused }), paused ? "Resumed" : "Paused"); S.policy = null; load(); };
      document.querySelectorAll("[data-rmrec]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this payee? The wallet stops paying them.")) return; await act(() => web("DELETE", "policy/recipients", { address: b.dataset.rmrec }), "Removed"); S.policy = null; load(); }));
    },
  },

  profile: {
    title: "Profile & privacy",
    async load() {
      const [prefs, addr, sec, me] = await Promise.all([web("GET", "me/preferences").catch(() => null), web("GET", "profile/address").catch(() => null), web("GET", "security").catch(() => null), web("GET", "me").catch(() => null)]);
      S.profile = { prefs, addr: (addr && (addr.address || addr)) || null, sec, me };
    },
    render(m) {
      const p = S.profile;
      const pr = (p && p.prefs && (p.prefs.preferences || p.prefs)) || {};
      const a = (p && p.addr) || {};
      m.innerHTML = `<h1>Profile & privacy</h1>${!p ? `<div class="card"><div class="loading"><span class="spin"></span>Loading…</div></div>` : `
        <div class="card" style="margin-bottom:12px"><h2>Preferences</h2>
          <label class="switch"><input type="checkbox" id="x-aichat" ${pr.aiChat !== false ? "checked" : ""}><span><b>AI chat</b><div class="hint">Off: nothing is sent to a model.</div></span></label>
          <label class="switch"><input type="checkbox" id="x-card" ${pr.cardCover ? "checked" : ""}><span><b>Cover a short balance with my linked card</b></span></label>
          <label>Also show amounts in</label><select id="x-also" style="width:auto"><option value="">-</option><option ${pr.showAlso === "THB" ? "selected" : ""}>THB</option><option ${pr.showAlso === "CNY" ? "selected" : ""}>CNY</option></select></div>
        <div class="card" style="margin-bottom:12px"><h2>Delivery address</h2><form id="x-addr">
          <div class="grid" style="grid-template-columns:1fr 1fr;margin:0"><div><label>Recipient</label><input name="recipient" value="${esc(a.recipient || "")}"></div><div><label>Phone</label><input name="phone" value="${esc(a.phone || "")}"></div></div>
          <label>Address line</label><input name="line" value="${esc(a.line || "")}">
          <div class="grid" style="grid-template-columns:1fr 1fr 1fr 110px;margin:0"><div><label>Province</label><select name="province" id="x-prov"></select></div><div><label>District</label><select name="district" id="x-dist"></select></div><div><label>Subdistrict</label><select name="subdistrict" id="x-sub"></select></div><div><label>Postcode</label><input name="postcode" id="x-post" maxlength="5" value="${esc(a.postcode || "")}"></div></div>
          <div class="row" style="margin-top:8px"><button class="primary">Save address</button></div></form></div>
        <div class="card" style="margin-bottom:12px"><h2>Second factor (2FA)</h2><p class="hint">${p.sec && (p.sec.enabled || (p.sec.methods || []).length) ? `On: ${esc((p.sec.methods || []).join(", "))}.` : "Off."} This app signs with its device key, which counts as the second factor here. Passkeys and authenticator apps are set up on the website.</p>
          <button id="x-2fa">Manage 2FA on the website</button></div>
        <div class="card" style="margin-bottom:12px"><h2>Your data</h2><p class="hint">Download everything the app keeps about you (PDPA).</p><button id="x-export">Download my data</button></div>
        <div class="card"><h2>Delete my account</h2><p class="hint">Deletes your account, profile and wallet links. On-chain transactions stay (they hold no names).</p><button class="danger" id="x-delete">Delete my account</button></div>`}`;
      if (!p) return;
      const savePref = (patch) => act(() => web("PUT", "me/preferences", patch), "Saved");
      $("#x-aichat").onchange = (e) => savePref({ aiChat: e.target.checked });
      $("#x-card").onchange = (e) => savePref({ cardCover: e.target.checked });
      $("#x-also").onchange = (e) => savePref({ showAlso: e.target.value || null });
      // Thai provinces, districts and subdistricts from the website's list; the postcode follows the subdistrict.
      web("GET", "address/th").then((tree) => {
        const opt = (list, cur) => `<option value="">-</option>${list.map(([n]) => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("")}`;
        const prov = $("#x-prov"), dist = $("#x-dist"), sub = $("#x-sub"), post = $("#x-post");
        if (!prov) return;
        const districts = () => (tree.find(([n]) => n === prov.value) || [, []])[1];
        const subs = () => (districts().find(([n]) => n === dist.value) || [, []])[1];
        prov.innerHTML = opt(tree, a.province); dist.innerHTML = opt(districts(), a.district); sub.innerHTML = opt(subs(), a.subdistrict);
        prov.onchange = () => { dist.innerHTML = opt(districts()); sub.innerHTML = opt([]); };
        dist.onchange = () => { sub.innerHTML = opt(subs()); };
        sub.onchange = () => { const hit = subs().find(([n]) => n === sub.value); if (hit) post.value = hit[1]; };
      }).catch(() => undefined);
      $("#x-addr").onsubmit = async (ev) => { ev.preventDefault(); const fd = Object.fromEntries(new FormData(ev.target)); await act(() => web("PUT", "profile/address", fd), "Address saved"); };
      $("#x-2fa").onclick = () => window.open(`${S.info.device.server}/profile`, "_blank", "noopener");
      $("#x-export").onclick = () => openWeb("me/export");
      $("#x-delete").onclick = async () => {
        const fd = await formDialog("Delete my account", `<p>Type <b>DELETE</b> to confirm.</p><input name="c" required>`, "Delete forever");
        if (!fd || fd.get("c") !== "DELETE") return;
        if (await act(() => web("DELETE", "me"), "Account deleted")) { await api("/app/lock", "POST").catch(() => null); location.reload(); }
      };
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Money: send to friends, link a card
// ---------------------------------------------------------------------------------------------

async function sendMoneyDialog() {
  const friends = (S.friends || (await api("/app/friends").then((f) => f.friends).catch(() => []))).filter((f) => f.status === "ACCEPTED");
  if (!friends.length) return toast("Add friends first (Friends)");
  const fd = await formDialog("Send money", friends.map((f) => `<div class="row" style="margin:6px 0"><span style="flex:1">${esc(f.name)} <span class="hint">@${esc(f.username)}</span></span><input name="a:${esc(f.userId)}" type="number" min="0" step="0.01" placeholder="0" style="width:140px"></div>`).join(""), "Send now", "From your own wallet; everyone is paid together, or nobody is. They must be your payees. Test money.");
  if (!fd) return;
  const recipients = [...fd.entries()].filter(([k, v]) => k.startsWith("a:") && Number(v) > 0).map(([k, v]) => ({ userId: k.slice(2), amount: Number(v) }));
  if (!recipients.length) return toast("Enter an amount");
  const r = await act(() => web("POST", "transfers", { recipients, requestId: crypto.randomUUID() }));
  if (r) { toast(r.already ? "Already sent" : "Sent"); load(); }
}

async function cardLinkHtml() {
  const c = await web("GET", "bank/stripe-link").catch(() => null);
  if (!c) return "";
  return `<div class="card" style="margin-top:12px"><h2>Linked card (Stripe test mode)</h2>${c.link ? `<p>${esc(c.link.brand.toUpperCase())} ••${esc(c.link.last4)} · exp ${esc(c.link.exp)}</p><button class="danger" id="x-unlink">Unlink</button>` : c.enabled ? `<p class="hint">Link a card once: top-ups from it need no new checkout, and it can cover a short balance when you approve a deal.</p><button id="x-link">Link a card</button>` : `<p class="hint">Card payments are not set up on this server.</p>`}</div>`;
}

function wireCardLink() {
  const l = $("#x-link"); if (l) l.onclick = async () => { const r = await act(() => web("POST", "bank/stripe-link", {})); if (r && r.url) { window.open(r.url, "_blank", "noopener"); toast("Finish in your browser, then come back"); } };
  const u = $("#x-unlink"); if (u) u.onclick = async () => { if (!confirm("Unlink the card?")) return; await act(() => web("DELETE", "bank/stripe-link"), "Unlinked"); load(); };
}

// ---------------------------------------------------------------------------------------------
// Friends: block, report, nicknames
// ---------------------------------------------------------------------------------------------

const REPORT_REASONS = ["SCAM", "SPAM", "HARASSMENT", "IMPERSONATION", "NOT_DELIVERED", "OTHER"];

async function friendsExtrasHtml() {
  const [blocks, nicks] = await Promise.all([web("GET", "blocks").catch(() => null), web("GET", "friends/nicknames").catch(() => null)]);
  const bl = (blocks && (blocks.blocks || blocks)) || [];
  const nk = (nicks && (nicks.nicknames || nicks)) || [];
  return `<div class="grid" style="margin-top:12px;grid-template-columns:1fr 1fr">
    <div class="card"><h2>Blocked</h2>${bl.length ? bl.map((b) => `<div class="row space"><span>${esc(b.name || b.username || b.userId)}</span><button data-unblock="${esc(b.userId)}">Unblock</button></div>`).join("") : `<p class="hint">Nobody.</p>`}</div>
    <div class="card"><h2>Nicknames the AI remembers</h2>${nk.length ? nk.map((n) => `<div class="row space"><span>“${esc(n.alias || n.nickname)}” <span class="hint">means ${esc(n.contact || n.name || "")}</span></span><button data-forget="${esc(n.id)}">Forget</button></div>`).join("") : `<p class="hint">None. Tell the AI "my designer means Nok" and it remembers.</p>`}</div></div>`;
}

function wireFriendsExtras() {
  document.querySelectorAll("[data-block]").forEach((b) => (b.onclick = async () => { if (!confirm("Block this person? They are removed from your contacts and cannot ask or pay you.")) return; await act(() => web("POST", "blocks", { userId: b.dataset.block }), "Blocked"); load(); }));
  document.querySelectorAll("[data-unblock]").forEach((b) => (b.onclick = async () => { await act(() => web("DELETE", `blocks/${b.dataset.unblock}`), "Unblocked"); load(); }));
  document.querySelectorAll("[data-forget]").forEach((b) => (b.onclick = async () => { await act(() => web("DELETE", `friends/nicknames?id=${encodeURIComponent(b.dataset.forget)}`), "Forgotten"); load(); }));
  document.querySelectorAll("[data-report]").forEach((b) => (b.onclick = async () => {
    const fd = await formDialog("Report", `<label>Reason</label><select name="reason">${REPORT_REASONS.map((r) => `<option value="${r}">${r.toLowerCase().replace("_", " ")}</option>`).join("")}</select><label>What happened?</label><textarea name="details" rows="4" maxlength="2000"></textarea>`, "Send report", "Reports go to the app's reviewers.");
    if (fd) await act(() => web("POST", "reports", { userId: b.dataset.report, reason: fd.get("reason"), details: fd.get("details") || "" }), "Reported");
  }));
  const sm = $("#x-send"); if (sm) sm.onclick = () => sendMoneyDialog();
}

// ---------------------------------------------------------------------------------------------
// Groups: rules and votes, invite link, leave, signers, company registration
// ---------------------------------------------------------------------------------------------

async function loadGroupDetail(gid) { S.groupDetail = S.groupDetail || {}; S.groupDetail[gid] = await web("GET", `groups/${gid}`).catch((e) => ({ error: e.message })); }

function groupManageHtml(x) {
  S.groupManage = S.groupManage || {};
  const open = S.groupManage[x.id];
  const d = (S.groupDetail || {})[x.id];
  const head = `<div class="row space" style="margin-top:10px"><b>Members and rules</b><button data-gman="${esc(x.id)}">${open ? "Hide" : "Manage"}</button></div>`;
  if (!open) return head;
  if (!d) return head + `<div class="loading"><span class="spin"></span>Loading…</div>`;
  if (d.error) return head + `<p class="hint">${esc(d.error)}</p>`;
  const admin = x.myRole === "ADMIN";
  const members = d.members || x.members;
  return head + `<table style="margin-top:6px"><tbody>${members.map((mm) => `<tr><td>${esc(mm.name)}${mm.role === "ADMIN" ? " (owner)" : ""}</td><td>${mm.canSign ? "signer" : "member"}</td><td style="text-align:right">${admin && mm.role !== "ADMIN" ? `<button data-gsign="${esc(x.id)}" data-u="${esc(mm.userId)}" data-v="${mm.canSign ? "0" : "1"}">${mm.canSign ? "Stop signing" : "Make signer"}</button><button class="danger" data-grm="${esc(x.id)}" data-u="${esc(mm.userId)}">Remove</button>` : ""}</td></tr>`).join("")}</tbody></table>
    <div style="margin-top:8px"><b>Rule changes</b> <span class="hint">(need the signers' vote)</span>${(d.rules || []).map((r) => `<div class="row space"><span>${esc(r.text)} <span class="chip">${esc(String(r.status).toLowerCase())}</span> <span class="hint">${r.yes} yes · ${r.no} no</span></span>${r.status === "OPEN" && r.myVote === null ? `<span class="row"><button class="primary" data-rvote="${esc(r.id)}" data-g="${esc(x.id)}" data-v="1">Yes</button><button data-rvote="${esc(r.id)}" data-g="${esc(x.id)}" data-v="0">No</button></span>` : ""}</div>`).join("") || `<div class="hint">None.</div>`}
    <div class="row" style="margin-top:6px"><button data-gthr="${esc(x.id)}">Propose: votes needed</button><button data-gaddsig="${esc(x.id)}">Propose: a new signer</button></div></div>
    <div class="row" style="margin-top:10px"><button data-glink="${esc(x.id)}">Invite link</button><button class="danger" data-gleave="${esc(x.id)}">Leave the group</button></div>`;
}

function wireGroupManage() {
  const on = (sel, fn) => document.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
  on("[data-gman]", async (b) => { const g = b.dataset.gman; S.groupManage = S.groupManage || {}; S.groupManage[g] = !S.groupManage[g]; renderView(); if (S.groupManage[g]) { await loadGroupDetail(g); renderView(); } });
  const again = async (g) => { await loadGroupDetail(g); renderView(); };
  on("[data-gsign]", async (b) => { await act(() => web("PATCH", `groups/${b.dataset.gsign}/members/${b.dataset.u}`, { canSign: b.dataset.v === "1" }), "Done"); again(b.dataset.gsign); });
  on("[data-grm]", async (b) => { if (!confirm("Remove this member?")) return; await act(() => web("DELETE", `groups/${b.dataset.grm}/members/${b.dataset.u}`), "Removed"); again(b.dataset.grm); });
  on("[data-rvote]", async (b) => { await act(() => web("POST", `groups/rules/${b.dataset.rvote}/vote`, { approve: b.dataset.v === "1" }), "Vote counted"); again(b.dataset.g); });
  on("[data-gthr]", async (b) => { const fd = await formDialog("Votes needed to pay", `<label>New number (at least 2)</label><input name="n" type="number" min="2" required>`, "Propose"); if (fd) { await act(() => web("POST", `groups/${b.dataset.gthr}/rules`, { kind: "SET_THRESHOLD", threshold: Number(fd.get("n")) }), "Proposed"); again(b.dataset.gthr); } });
  on("[data-gaddsig]", async (b) => {
    const g = ((S.groups && S.groups.groups) || []).find((x) => x.id === b.dataset.gaddsig);
    const cands = (g ? g.members : []).filter((mm) => !mm.canSign);
    if (!cands.length) return toast("Every member signs already");
    const fd = await formDialog("Propose a new signer", `<select name="u">${cands.map((mm) => `<option value="${esc(mm.userId)}">${esc(mm.name)}</option>`).join("")}</select>`, "Propose");
    if (fd) { await act(() => web("POST", `groups/${b.dataset.gaddsig}/rules`, { kind: "ADD_SIGNER", targetUserId: fd.get("u") }), "Proposed"); again(b.dataset.gaddsig); }
  });
  on("[data-glink]", async (b) => { const r = await act(() => web("POST", `groups/${b.dataset.glink}/link`, {})); if (r && r.url) { await navigator.clipboard.writeText(r.url).catch(() => null); formDialog("Invite link", `<p class="mono">${esc(r.url)}</p><p class="hint">Copied. Valid until ${fmtDate(r.expiresAt)}. Anyone with it can ask to join.</p>`, "OK"); } });
  on("[data-gleave]", async (b) => { if (!confirm("Leave this group?")) return; await act(() => web("POST", `groups/${b.dataset.gleave}/leave`, {}), "You left the group"); load(); });
  on("#x-company", async () => {
    const friends = (S.friends || []).filter((f) => f.status === "ACCEPTED");
    const fd = await formDialog("Register a company", `<label>Company name</label><input name="name" required minlength="2"><label>Company registration (tax) number</label><input name="taxId" required minlength="13" maxlength="24">
      <label>Members</label>${friends.map((f) => `<label class="switch" style="padding:4px 0"><input type="checkbox" name="mem" value="${esc(f.userId)}"><span>${esc(f.name)}</span></label>`).join("") || `<p class="hint">Add friends first.</p>`}
      <label>Votes needed to pay</label><input name="th" type="number" min="2" value="2" required>`, "Register", "Its own wallet, paid out by its signers' vote. Test mode.");
    if (!fd) return;
    await act(() => web("POST", "companies", { name: fd.get("name"), taxId: fd.get("taxId"), members: fd.getAll("mem").map((u) => ({ userId: u, canSign: true })), threshold: Number(fd.get("th")) }), "Company registered");
    load();
  });
}

// ---------------------------------------------------------------------------------------------
// Header: notifications and search
// ---------------------------------------------------------------------------------------------

async function loadHeader() {
  const [a, inv, fr, deals, groups] = await Promise.all([web("GET", "approvals").catch(() => null), web("GET", "groups/invites").catch(() => null), api("/app/friends").catch(() => null), api("/app/deals").catch(() => null), api("/app/groups").catch(() => null)]);
  const items = [];
  for (const r of (a && a.reviews) || []) items.push({ text: `Review the delivery for D-${r.dealId} · ${r.title}`, view: "deals" });
  for (const o of (a && a.offers) || []) items.push({ text: `Offer from ${o.sellerLabel || "a seller"}: ${o.title}`, view: "deals" });
  for (const v of (a && a.groupVotes) || []) items.push({ text: `${v.group.name} votes on: ${v.title}`, view: "groups" });
  for (const t of (a && a.sellerTodo) || []) items.push({ text: `${t.step === "accept" ? "Accept" : "Deliver"} D-${t.dealId} · ${t.title}`, view: "deals" });
  for (const d of (a && a.drafts) || []) items.push({ text: `Preview waiting for Confirm: ${d.title}`, view: "deals" });
  for (const i of (inv && inv.invites) || []) items.push({ text: `${i.invitedBy || "Someone"} invited you to ${i.name || "a group"}`, view: "groups" });
  for (const f of ((fr && fr.friends) || []).filter((x) => x.direction === "incoming")) items.push({ text: `${f.name} wants to add you`, view: "contacts" });
  S.notes = items;
  S.searchIndex = [
    ...((deals && deals.deals) || []).map((d) => ({ text: `D-${d.id} · ${d.title} · ${d.counterpartyLabel || ""}`, view: "deals" })),
    ...(((fr && fr.friends) || []).filter((x) => x.status === "ACCEPTED")).map((f) => ({ text: `${f.name} · @${f.username}`, view: "contacts" })),
    ...(((groups && groups.groups) || [])).map((g) => ({ text: `Group · ${g.name}`, view: "groups" })),
  ];
}

function headerHtml() {
  const n = (S.notes || []).length;
  return `<div class="topbar"><input id="x-search" placeholder="Search deals, friends, groups…" autocomplete="off" value="${esc(S.searchQ || "")}"><div id="x-hits"></div>
    <button id="x-bell" title="Notifications">🔔${n ? ` <b class="bell-n">${n}</b>` : ""}</button><button id="x-lang" title="Language">${S.lang === "en" ? "TH" : "EN"}</button>
    ${S.bellOpen ? `<div class="bell-pop">${n ? S.notes.map((it, i) => `<button data-note="${i}">${esc(it.text)}</button>`).join("") : `<p class="hint">Nothing waits for you.</p>`}</div>` : ""}</div>`;
}

function wireHeader() {
  const s = $("#x-search"), hits = $("#x-hits");
  if (s) s.oninput = () => {
    S.searchQ = s.value;
    const q = s.value.trim().toLowerCase();
    const found = q.length < 2 ? [] : (S.searchIndex || []).filter((h) => h.text.toLowerCase().includes(q)).slice(0, 8);
    hits.innerHTML = found.length ? `<div class="bell-pop">${found.map((h, i) => `<button data-hit="${i}">${esc(h.text)}</button>`).join("")}</div>` : "";
    hits.querySelectorAll("[data-hit]").forEach((b) => (b.onclick = () => { S.searchQ = ""; go(found[Number(b.dataset.hit)].view); }));
  };
  const bell = $("#x-bell"); if (bell) bell.onclick = () => { S.bellOpen = !S.bellOpen; renderApp(); };
  document.querySelectorAll("[data-note]").forEach((b) => (b.onclick = () => { S.bellOpen = false; go(S.notes[Number(b.dataset.note)].view); }));
  const lang = $("#x-lang"); if (lang) lang.onclick = () => { S.lang = S.lang === "en" ? "th" : "en"; try { localStorage.setItem("awlang", S.lang); } catch {} renderApp(); };
}

// ---------------------------------------------------------------------------------------------
// Thai: the website's dictionary (th.json) plus the app's own strings, applied to the screen
// ---------------------------------------------------------------------------------------------

const TH = window.TH_DICT || {};
function translateNode(root) {
  if (S.lang !== "th" || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const todo = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.parentElement && n.parentElement.closest(".md, pre, code, .mono, textarea, script, style")) continue;
    const t = n.nodeValue.trim();
    if (t && TH[t]) todo.push([n, t]);
  }
  for (const [n, t] of todo) n.nodeValue = n.nodeValue.replace(t, TH[t]);
  root.querySelectorAll && root.querySelectorAll("[placeholder],[title]").forEach((el) => {
    for (const a of ["placeholder", "title"]) { const v = el.getAttribute(a); if (v && TH[v.trim()]) el.setAttribute(a, TH[v.trim()]); }
  });
}
new MutationObserver((muts) => { if (S.lang !== "th") return; for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) translateNode(n); else if (n.nodeType === 3 && n.parentElement) translateNode(n.parentElement); }).observe(document.body, { childList: true, subtree: true });
