import { appPage, esc, standalonePage } from "./layout.js";

/** Minimal digest shape consumed by the dashboard (from @aigos/action buildDigest). */
export interface DashboardDigest {
  opportunities: number;
  recommendations: number;
  drafts: { draftType: string; status: string }[];
  pendingApprovals: { draftType: string; status: string }[];
  completed: number;
  feed: {
    total: number;
    items: {
      opportunityId: string;
      entity: string;
      severity: string;
      impact: string;
      effort: string;
      priorityScore: number;
      recommendation: { title: string; summary: string } | null;
    }[];
  };
}

export interface TodayContext {
  readonly email: string;
  readonly locale: string;
  readonly workspaceName: string;
  readonly planId: string;
  readonly date: Date;
  readonly digest: DashboardDigest;
}

export function todayPage(ctx: TodayContext): string {
  const dateLabel = new Intl.DateTimeFormat(ctx.locale, { weekday: "long", day: "numeric", month: "long" }).format(ctx.date);
  const header = `<p class="muted">${esc(dateLabel)} · ${esc(ctx.workspaceName)} · plan ${esc(ctx.planId)}</p>`;

  if (ctx.digest.feed.total === 0) {
    return appPage("/", "Today", ctx.email,
      `${header}
       <div style="margin-top:24px;padding:24px;border:1px dashed #ccc;border-radius:8px;background:#fff">
         <p>No actions yet.</p>
         <p class="muted">Your feed starts with your first data source — connect Google Search Console to generate your first personalized actions from your real search data.</p>
       </div>`);
  }

  const items = ctx.digest.feed.items
    .map((it) => `
      <div style="padding:16px;border:1px solid #e5e5e5;border-radius:8px;background:#fff;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <strong>${esc(it.recommendation?.title ?? it.entity)}</strong>
          <span class="muted">priority ${esc(String(it.priorityScore))}</span>
        </div>
        <p class="muted" style="margin-top:4px">${esc(it.entity)}</p>
        <p class="muted">severity ${esc(it.severity)} · impact ${esc(it.impact)} · effort ${esc(it.effort)}</p>
        ${it.recommendation ? `<p style="margin-top:4px">${esc(it.recommendation.summary)}</p>` : ""}
        <p><a href="/opportunities/${esc(it.opportunityId)}">Details &amp; evidence →</a></p>
      </div>`)
    .join("");

  const d = ctx.digest;
  const summary = `
    <div style="margin:16px 0;padding:12px 16px;background:#f5f5f5;border-radius:8px;font-size:14px">
      <strong>Daily summary</strong> ·
      ${d.opportunities} opportunities · ${d.recommendations} recommendations ·
      ${d.drafts.length} drafts (${d.pendingApprovals.length} pending) · ${d.completed} completed
    </div>`;

  return appPage("/", "Today", ctx.email, `${header}${summary}${items}`);
}

export const loginPage = (): string =>
  standalonePage(
    "Sign in",
    `<p class="muted">Enter your email to receive a sign-in link.</p>
     <form id="f"><input type="email" name="email" placeholder="you@company.com" required autofocus>
     <button type="submit">Send link</button></form><p id="m" class="muted"></p>
     <script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();
       await fetch('/auth/request-link',{method:'POST',headers:{'content-type':'application/json','x-csrf':'1'},
       body:JSON.stringify({email:e.target.email.value})});
       document.getElementById('m').textContent='If this address exists, a link is on its way. Check your email.';});</script>`,
  );

export const confirmPage = (token: string): string =>
  standalonePage(
    "Confirm sign-in",
    `<p class="muted">Confirm sign-in to your workspace.</p>
     <button id="b">Confirm sign-in</button><p id="m" class="muted"></p>
     <script>document.getElementById('b').addEventListener('click',async()=>{
       const r=await fetch('/auth/confirm',{method:'POST',headers:{'content-type':'application/json','x-csrf':'1'},
       body:JSON.stringify({token:'${token}'})});
       if(r.ok){location.href='/';}else{document.getElementById('m').textContent='This link is invalid or has expired.';}});</script>`,
  );

const SECTIONS: Record<string, { title: string; empty: string }> = {
  "/learnings": { title: "Learnings", empty: "Nothing learned yet — learnings appear as actions complete and outcomes are measured." },
};

export interface ExperimentRow {
  id: string;
  hypothesis: string;
  expectedImpact: string;
  confidence: string;
  metrics: string;
  recommendationSource: string;
}

/** Experiments page (STEP 6.4) — read-only, grouped by state. Empty until the Experiment Engine runs. */
export function experimentsPage(email: string, groups: { running: ExperimentRow[]; completed: ExperimentRow[]; archived: ExperimentRow[] }): string {
  const section = (label: string, rows: ExperimentRow[]): string => {
    const body = rows.length === 0
      ? `<p class="muted">No ${label.toLowerCase()} experiments.</p>`
      : rows.map((e) => `<div style="padding:12px;border:1px solid #e5e5e5;border-radius:8px;background:#fff;margin-bottom:8px">
          <strong>${esc(e.hypothesis)}</strong>
          <p class="muted">expected impact ${esc(e.expectedImpact)} · confidence ${esc(e.confidence)}</p>
          <p class="muted">metrics: ${esc(e.metrics)} · source: ${esc(e.recommendationSource)}</p></div>`).join("");
    return `<h2 style="font-size:15px;margin:16px 0 4px">${esc(label)}</h2>${body}`;
  };
  const total = groups.running.length + groups.completed.length + groups.archived.length;
  const intro = total === 0
    ? `<p class="muted">No experiments yet — experiments appear when you accept a recommendation and start measuring its outcome.</p>`
    : "";
  return appPage("/experiments", "Experiments", email,
    `${intro}${section("Running", groups.running)}${section("Completed", groups.completed)}${section("Archived", groups.archived)}`);
}

export interface SettingsContext {
  readonly email: string;
  readonly locale: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly region: string;
  readonly planId: string;
  readonly devices: { id: string; uaFamily: string; createdAt: string; current: boolean }[];
  readonly connections: { provider: string; status: string }[];
}

const PROVIDER_LABELS: Record<string, string> = { gsc: "Google Search Console" };

export function settingsPage(ctx: SettingsContext): string {
  const rows = ctx.devices
    .map(
      (d) => `<tr><td>${esc(d.uaFamily)}${d.current ? ' <strong>· This device</strong>' : ""}</td>
      <td class="muted">${esc(d.createdAt.slice(0, 10))}</td>
      <td>${d.current
        ? `<button data-logout>Sign out</button>`
        : `<button data-revoke="${esc(d.id)}">Sign out</button>`}</td></tr>`,
    )
    .join("");
  return appPage(
    "/settings",
    "Settings",
    ctx.email,
    `<h2 style="font-size:15px;margin:16px 0 4px">Profile</h2>
     <p class="muted">${esc(ctx.email)} · locale ${esc(ctx.locale)}</p>
     <h2 style="font-size:15px;margin:16px 0 4px">Workspace</h2>
     <p class="muted">${esc(ctx.workspaceName)} · region ${esc(ctx.region)} · plan ${esc(ctx.planId)}</p>
     <h2 style="font-size:15px;margin:16px 0 4px">Connections</h2>
     ${ctx.connections.some((c) => c.provider === "gsc")
       ? ctx.connections
           .filter((c) => c.provider === "gsc")
           .map((c) => `<p class="muted">${esc(PROVIDER_LABELS[c.provider] ?? c.provider)} · ${esc(c.status)}</p>`)
           .join("")
       : `<p class="muted">Connect a data source to start your feed.</p>
          <a href="/connections/google/authorize?workspaceId=${esc(ctx.workspaceId)}"><button style="width:auto;padding:8px 12px">Connect Google Search Console</button></a>`}
     <h2 style="font-size:15px;margin:16px 0 4px">Devices</h2>
     <table style="width:100%;font-size:14px;border-collapse:collapse">${rows}</table>
     <button id="others" style="width:auto;margin-top:12px;padding:8px 12px">Sign out all other devices</button>
     <script>
     const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json','x-csrf':'1'},body:b?JSON.stringify(b):null});
     document.querySelectorAll('[data-revoke]').forEach(el=>el.addEventListener('click',async()=>{await post('/me/sessions/revoke',{sessionId:el.dataset.revoke});location.reload();}));
     document.querySelectorAll('[data-logout]').forEach(el=>el.addEventListener('click',async()=>{await post('/auth/logout');location.href='/login';}));
     document.getElementById('others').addEventListener('click',async()=>{await post('/me/sessions/revoke-others');location.reload();});
     </script>`,
  );
}

export function sectionPage(path: string, email: string): string {
  const section = SECTIONS[path]!;
  return appPage(path, section.title, email, `<p class="muted">${section.empty}</p>`);
}

export const SECTION_PATHS = Object.keys(SECTIONS);

/** Opportunity detail page (STEP 6.2). Evidence always cites evidenceReferenceId. */
export function opportunityPage(email: string, d: import("@aigos/growth").OpportunityDetail): string {
  const evidence = d.evidence
    .map((e) => `<li><code>${esc(e.evidenceReferenceId)}</code> — ${esc(e.generatedBy)}: ${esc(JSON.stringify(e.data))}</li>`)
    .join("");
  const timeline = d.timeline.length
    ? d.timeline.map((t) => `<li>${esc(t.at.slice(0, 19))} — ${esc(t.from)} → <strong>${esc(t.to)}</strong>${t.reason ? ` (${esc(t.reason)})` : ""}</li>`).join("")
    : `<li class="muted">detected (no transitions yet)</li>`;
  const rec = d.recommendation;
  return appPage("/", `Opportunity`, email, `
    <p><a href="/">← Today</a></p>
    <h2 style="font-size:16px">${esc(rec?.title ?? d.entity)}</h2>
    <p class="muted">${esc(d.entity)}</p>
    <p class="muted">status ${esc(d.status)} · severity ${esc(d.severity)} · impact ${esc(d.impact)} · effort ${esc(d.effort)} · confidence ${esc(d.confidence)} · priority ${esc(String(d.priorityScore))}</p>
    <h3 style="font-size:14px;margin-top:16px">Recommendation</h3>
    ${rec ? `<p>${esc(rec.summary)}</p><p class="muted">Why (business): ${esc(rec.businessReason)}</p><p class="muted">Why (technical): ${esc(rec.technicalReason)}</p>
      <p class="muted">Expected impact: ${esc(rec.expectedImpact)}</p>
      <ol>${rec.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <p class="muted">Rollback: ${esc(rec.rollback)}</p>` : `<p class="muted">No recommendation.</p>`}
    <h3 style="font-size:14px;margin-top:16px">Evidence</h3>
    <ul style="font-size:13px">${evidence}</ul>
    <h3 style="font-size:14px;margin-top:16px">Status history (immutable)</h3>
    <ul style="font-size:13px">${timeline}</ul>`);
}

/** Action Center (STEP 6.3): all generated drafts with review/approve/reject/archive. */
export function actionsPage(email: string, workspaceId: string, drafts: import("@aigos/action").DraftListItem[]): string {
  if (drafts.length === 0) {
    return appPage("/actions", "Action Center", email, `<p class="muted">No drafts yet. Drafts are generated from accepted recommendations.</p>`);
  }
  const btn = (id: string, to: string, label: string): string =>
    `<button data-draft="${esc(id)}" data-to="${esc(to)}" style="width:auto;padding:6px 10px;margin-right:6px">${label}</button>`;
  const rows = drafts.map((d) => `
    <div style="padding:16px;border:1px solid #e5e5e5;border-radius:8px;background:#fff;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between"><strong>${esc(d.draftType)}</strong><span class="muted">${esc(d.status)}</span></div>
      <p class="muted">${esc(d.recommendationTitle ?? "")} — ${esc(d.entity ?? "")}</p>
      <pre style="white-space:pre-wrap;font-size:13px;background:#fafafa;padding:8px;border-radius:6px">${esc(d.content)}</pre>
      <p class="muted">model ${esc(d.provider)}/${esc(d.tier)} · tokens ${d.inputTokens}+${d.outputTokens} · cost €${esc(d.costEur.toFixed(4))} · ${d.cached ? "cached" : "live"} · evidence ${d.evidenceCount}</p>
      <div>${btn(d.id, "reviewed", "Review")}${btn(d.id, "approved", "Approve")}${btn(d.id, "rejected", "Reject")}${btn(d.id, "archived", "Archive")}</div>
    </div>`).join("");
  return appPage("/actions", "Action Center", email, `${rows}
    <script>
    document.querySelectorAll('[data-draft]').forEach(el=>el.addEventListener('click',async()=>{
      await fetch('/drafts/transition',{method:'POST',headers:{'content-type':'application/json','x-csrf':'1'},
      body:JSON.stringify({workspaceId:'${workspaceId}',draftId:el.dataset.draft,to:el.dataset.to})});location.reload();}));
    </script>`);
}

export interface ConnectionView {
  id: string;
  provider: string;
  status: string;
  healthStatus: string;
  scopes: string[];
  site: string | null;
  lastSuccessfulSync: string | null;
  lastAttemptedSync: string | null;
  importedRows: number;
  apiQuotaUsed: number;
  lastError: string | null;
  needsReconnect: boolean;
}

/** Connections page (STEP 6.5) — GSC state from existing repositories; reconnect reuses the OAuth flow. */
export function connectionsPage(email: string, workspaceId: string, conns: ConnectionView[]): string {
  if (conns.length === 0) {
    return appPage("/connections", "Connections", email,
      `<p class="muted">No connections yet.</p>
       <a href="/connections/google/authorize?workspaceId=${esc(workspaceId)}"><button style="width:auto;padding:8px 12px">Connect Google Search Console</button></a>`);
  }
  const rows = conns.map((c) => `
    <div style="padding:16px;border:1px solid #e5e5e5;border-radius:8px;background:#fff;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between"><strong>${esc(PROVIDER_LABELS[c.provider] ?? c.provider)}</strong>
        <span class="muted">status ${esc(c.status)} · health ${esc(c.healthStatus)}</span></div>
      <p class="muted">site: ${esc(c.site ?? "not selected")}</p>
      <p class="muted">permissions: ${esc(c.scopes.join(", ") || "none")}</p>
      <p class="muted">last sync: ${esc(c.lastSuccessfulSync ?? "never")} · last attempt: ${esc(c.lastAttemptedSync ?? "never")}</p>
      <p class="muted">ingested rows: ${c.importedRows} · API calls: ${c.apiQuotaUsed}${c.lastError ? ` · last error: ${esc(c.lastError)}` : ""}</p>
      <p class="muted">refresh token: ${c.needsReconnect ? "reconnect required" : "valid"}</p>
      ${c.needsReconnect ? `<a href="/connections/google/authorize?workspaceId=${esc(workspaceId)}"><button style="width:auto;padding:6px 10px">Reconnect</button></a>` : ""}
    </div>`).join("");
  return appPage("/connections", "Connections", email, rows);
}

export interface NotificationEntry { category: string; title: string; at: string; }

/** Notification Center (STEP 6.6) — categories from Delivery's model; history when persisted. */
export function notificationsPage(email: string, entries: NotificationEntry[]): string {
  const categories = ["Digests", "Alerts", "Warnings", "Failures"];
  const byCat = (cat: string): NotificationEntry[] => entries.filter((e) => e.category === cat);
  const section = (cat: string): string => {
    const rows = byCat(cat);
    const body = rows.length === 0
      ? `<p class="muted">No ${cat.toLowerCase()} yet.</p>`
      : rows.map((e) => `<p>${esc(e.at.slice(0, 19))} — ${esc(e.title)}</p>`).join("");
    return `<h2 style="font-size:15px;margin:16px 0 4px">${esc(cat)}</h2>${body}`;
  };
  const intro = entries.length === 0
    ? `<p class="muted">No notifications yet. Digests and alerts appear here once Delivery sends them.</p>`
    : "";
  return appPage("/notifications", "Notifications", email, `${intro}${categories.map(section).join("")}`);
}

export interface AdminView {
  workspaceName: string;
  region: string;
  planId: string;
  limits: Record<string, unknown>;
  members: { email: string; role: string }[];
  usage: { requests: number; costEur: number; inputTokens: number; outputTokens: number };
}

/** Workspace Administration (STEP 6.7) — from memberships/plans/llm_calls; membership-gated. */
export function adminPage(email: string, v: AdminView): string {
  const members = v.members.map((m) => `<tr><td>${esc(m.email)}</td><td class="muted">${esc(m.role)}</td></tr>`).join("");
  const limits = Object.entries(v.limits).map(([k, val]) => `${esc(k)}: ${esc(String(val))}`).join(" · ") || "none";
  return appPage("/admin", "Administration", email, `
    <h2 style="font-size:15px;margin:16px 0 4px">Workspace</h2>
    <p class="muted">${esc(v.workspaceName)} · region ${esc(v.region)}</p>
    <h2 style="font-size:15px;margin:16px 0 4px">Members &amp; roles</h2>
    <table style="width:100%;font-size:14px">${members}</table>
    <h2 style="font-size:15px;margin:16px 0 4px">Plan &amp; limits</h2>
    <p class="muted">plan ${esc(v.planId)} · ${limits}</p>
    <h2 style="font-size:15px;margin:16px 0 4px">Usage</h2>
    <p class="muted">${v.usage.requests} AI requests · ${v.usage.inputTokens}+${v.usage.outputTokens} tokens · €${esc(v.usage.costEur.toFixed(4))}</p>`);
}

/** AI Usage Dashboard (STEP 6.8) from the llm_calls ledger (CostMeter-persisted). */
export function usagePage(email: string, u: import("@aigos/action").UsageSummary): string {
  const providers = u.byProvider.map((p) => `<tr><td>${esc(p.provider)}</td><td>${p.requests}</td><td>€${esc(p.costEur.toFixed(4))}</td></tr>`).join("");
  const monthly = u.monthly.map((m) => `<tr><td>${esc(m.month)}</td><td>${m.requests}</td><td>€${esc(m.costEur.toFixed(4))}</td></tr>`).join("");
  const history = u.history.map((r) => `<tr><td>${esc(r.feature)}</td><td>${esc(r.provider)}/${esc(r.tier)}</td><td>${r.inputTokens}+${r.outputTokens}</td><td>€${esc(r.costEur.toFixed(4))}</td><td>${r.cached ? "cached" : "live"}</td><td class="muted">${esc(r.at.slice(0,19))}</td></tr>`).join("");
  return appPage("/usage", "AI Usage", email, `
    <div style="margin:8px 0;padding:12px 16px;background:#f5f5f5;border-radius:8px;font-size:14px">
      <strong>Summary</strong> · ${u.requests} requests · ${u.inputTokens}+${u.outputTokens} tokens · €${esc(u.costEur.toFixed(4))} · ${u.cacheHits} cache hits · avg latency ${u.avgLatencyMs !== null ? Math.round(u.avgLatencyMs) + "ms" : "n/a"}
    </div>
    <h2 style="font-size:15px;margin:16px 0 4px">By provider</h2>
    <table style="width:100%;font-size:14px"><tr><th align=left>Provider</th><th align=left>Requests</th><th align=left>Cost</th></tr>${providers || '<tr><td class="muted">none</td></tr>'}</table>
    <h2 style="font-size:15px;margin:16px 0 4px">Monthly cost</h2>
    <table style="width:100%;font-size:14px"><tr><th align=left>Month</th><th align=left>Requests</th><th align=left>Cost</th></tr>${monthly || '<tr><td class="muted">none</td></tr>'}</table>
    <h2 style="font-size:15px;margin:16px 0 4px">Recent history</h2>
    <table style="width:100%;font-size:13px"><tr><th align=left>Feature</th><th align=left>Model</th><th align=left>Tokens</th><th align=left>Cost</th><th align=left>Cache</th><th align=left>When</th></tr>${history || '<tr><td class="muted">none</td></tr>'}</table>`);
}
