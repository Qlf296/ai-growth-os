import { appPage, standalonePage } from "./layout.js";

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
  "/": { title: "Today", empty: "No actions yet. Connect a data source to get your first recommendations." },
  "/experiments": { title: "Experiments", empty: "No experiments yet." },
  "/learnings": { title: "Learnings", empty: "Nothing learned yet — learnings appear as actions complete and outcomes are measured." },
  "/settings": { title: "Settings", empty: "Settings arrive in the next step." },
};

export function sectionPage(path: string, email: string): string {
  const section = SECTIONS[path]!;
  return appPage(path, section.title, email, `<p class="muted">${section.empty}</p>`);
}

export const SECTION_PATHS = Object.keys(SECTIONS);
