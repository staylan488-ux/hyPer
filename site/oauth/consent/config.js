// "Sign in with hyPer": the consent page's public client settings.
//
// supabaseUrl and supabaseAnonKey are the same public values the iPhone app
// ships with: the Supabase project's address and its anon (publishable) key.
// They are safe in a browser, because row-level security is what protects the
// data. NEVER put the service-role or secret key here; the page refuses to run
// with one.
//
// Fill both in before publishing site/ to Cloudflare Pages. A deploy can also
// write them into the page's <meta name="hyper:supabase-url"> and
// <meta name="hyper:supabase-anon-key"> tags, which win over this file. If the
// project's address is not on supabase.co, put it in connect-src in
// site/_headers too.
//
// mcpUrl is the address people paste into Claude, ChatGPT or another MCP
// client. The page shows it when it is opened without a request.
window.HYPER_OAUTH_CONFIG = {
  supabaseUrl: 'https://auth.thehyper.app',
  supabaseAnonKey: 'sb_publishable_vVlQ-89lps9qaWxKw4GT7A_cbePJGpN',
  mcpUrl: 'https://mcp.thehyper.app',
};
