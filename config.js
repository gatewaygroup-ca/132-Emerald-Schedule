/* ============================================================
   Site configuration
   ------------------------------------------------------------
   The schedule is stored in `schedule.json` in this GitHub repo.
   - Clients read it from the deployed Vercel site (no login).
   - The admin edits it from the website; each change is committed
     to GitHub, which triggers Vercel to redeploy automatically.
   No database or other service is needed.
   ============================================================ */
const SITE_CONFIG = {
  owner: "gatewaygroup-ca",        // GitHub account / organisation
  repo: "132-Emerald-Schedule",    // GitHub repository name
  branch: "main",                  // branch Vercel deploys to production
  dataPath: "schedule.json",       // file that holds the schedule
  pollSeconds: 30,                 // how often client screens check for updates
};
