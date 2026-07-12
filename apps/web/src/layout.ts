const NAV: [string, string][] = [
  ["/", "Today"],
  ["/actions", "Actions"],
  ["/experiments", "Experiments"],
  ["/learnings", "Learnings"],
  ["/notifications", "Notifications"],
  ["/connections", "Connections"],
  ["/usage", "Usage"],
  ["/admin", "Admin"],
  ["/settings", "Settings"],
];

export const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root{color-scheme:light;font-family:system-ui,sans-serif}
*{box-sizing:border-box;margin:0}
body{display:flex;min-height:100vh;color:#1a1a1a;background:#fafafa}
nav{width:200px;padding:24px 16px;border-right:1px solid #e5e5e5;background:#fff}
nav .brand{font-weight:600;margin-bottom:24px;font-size:15px}
nav a{display:block;padding:8px 10px;border-radius:6px;color:#444;text-decoration:none;font-size:14px}
nav a[aria-current="page"]{background:#f0f0f0;color:#000;font-weight:500}
main{flex:1;padding:32px;max-width:860px}
h1{font-size:20px;margin-bottom:8px}
.muted{color:#777;font-size:14px}
.user{margin-top:24px;font-size:12px;color:#999;word-break:break-all}
.card{max-width:360px;margin:15vh auto;padding:32px;background:#fff;border:1px solid #e5e5e5;border-radius:8px}
input,button{width:100%;padding:10px;margin-top:8px;font-size:14px;border-radius:6px;border:1px solid #ccc}
button{background:#1a1a1a;color:#fff;border:none;cursor:pointer}
@media (max-width:640px){body{flex-direction:column}nav{width:100%;display:flex;gap:4px;align-items:center;border-right:none;border-bottom:1px solid #e5e5e5;padding:12px}nav .brand{margin:0 12px 0 0}nav .user{display:none}main{padding:16px}}
`;

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} — AI Growth OS</title><style>${STYLE}</style></head><body>${body}</body></html>`;

export function appPage(active: string, title: string, email: string, content: string): string {
  const links = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${href === active ? ' aria-current="page"' : ""}>${label}</a>`,
  ).join("");
  return page(
    title,
    `<nav><div class="brand">AI Growth OS</div>${links}<div class="user">${esc(email)}</div></nav><main><h1>${esc(title)}</h1>${content}</main>`,
  );
}

export function standalonePage(title: string, content: string): string {
  return page(title, `<div class="card"><div class="brand" style="font-weight:600;margin-bottom:16px">AI Growth OS</div>${content}</div>`);
}
