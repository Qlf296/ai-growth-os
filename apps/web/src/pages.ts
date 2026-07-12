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
  "/experiments": { title: "Experiments", empty: "No experiments yet." },
  "/learnings": { title: "Learnings", empty: "Nothing learned yet — learnings appear as actions complete and outcomes are measured." },
};

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
