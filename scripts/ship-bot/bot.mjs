// hyPer Discord ship-bot: a /ship slash command that runs scripts/ship.sh on
// this machine (build -> sign -> upload to TestFlight) and narrates progress in
// the #deploys channel so both teammates see who shipped what.
//
// Config comes from ~/.hyper-ship/config.env (loaded by run-bot.sh) — the bot
// token and IDs are NEVER committed (this repo is public).
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { spawn } from 'node:child_process';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;
const CHANNEL_ID = process.env.DISCORD_DEPLOYS_CHANNEL_ID;
const ALLOWED = (process.env.DISCORD_ALLOWED_USER_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const SHIP_SCRIPT = process.env.SHIP_SCRIPT;

for (const [name, val] of Object.entries({ TOKEN, APP_ID, CHANNEL_ID, SHIP_SCRIPT })) {
  if (!val) { console.error(`FATAL: missing ${name} in environment`); process.exit(1); }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let shipping = false;

const shipCommand = new SlashCommandBuilder()
  .setName('ship')
  .setDescription('Build the latest main and upload it to TestFlight');

const rest = new REST({ version: '10' }).setToken(TOKEN);
async function registerIn(guildId) {
  await rest.put(Routes.applicationGuildCommands(APP_ID, guildId), { body: [shipCommand.toJSON()] });
}

client.once('clientReady', async () => {
  // Register per-guild so the command is available instantly (global takes ~1h).
  for (const [guildId] of client.guilds.cache) await registerIn(guildId);
  console.log(`ship-bot ready as ${client.user.tag}, /ship registered in ${client.guilds.cache.size} guild(s)`);
});

// Auto-register the moment the bot is added to a server.
client.on('guildCreate', async (guild) => {
  await registerIn(guild.id);
  console.log(`/ship registered in newly-joined guild "${guild.name}"`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'ship') return;

  const tag = `${interaction.user.username} (${interaction.user.id})`;
  const stamp = () => new Date().toISOString();
  console.log(`[${stamp()}] /ship received from ${tag} in guild ${interaction.guildId || 'DM'}`);

  try {
    if (!ALLOWED.includes(interaction.user.id)) {
      console.log(`  -> rejected: ${tag} not on allowlist`);
      await interaction.reply({ content: '⛔ You are not on the ship allowlist.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (shipping) {
      console.log('  -> rejected: a ship is already in progress');
      await interaction.reply({ content: '⏳ A ship is already in progress — hang tight.', flags: MessageFlags.Ephemeral });
      return;
    }

    shipping = true;
    await interaction.reply({ content: '🚀 Shipping started — watch the channel.', flags: MessageFlags.Ephemeral });

    const who = interaction.member?.displayName || interaction.user.username;
    let channel;
    try {
      channel = await client.channels.fetch(CHANNEL_ID);
      await channel.send(`🔨 **${who}** is shipping a new build to TestFlight…`);
    } catch (err) {
      console.error('could not post to deploys channel:', err);
    }

    const child = spawn('bash', [SHIP_SCRIPT], { env: process.env });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });

    child.on('error', async (err) => {
      shipping = false;
      console.error(`[${stamp()}] ship by ${tag} could not start:`, err);
      try { await channel?.send(`❌ Ship by **${who}** couldn't start: ${err.message}`); } catch {}
    });

    child.on('close', async (code) => {
      shipping = false;
      const build = (out.match(/Shipping hyPer build (\d+)/) || [])[1] || '?';
      const ok = code === 0 && /Successfully uploaded the new binary/.test(out);
      console.log(`[${stamp()}] ship by ${tag} finished: exit ${code}, ok=${ok}, build=${build}`);
      const msg = ok
        ? `✅ **Build ${build}** uploaded to TestFlight by **${who}** — Apple is processing it now (usually 5–30 min), then it shows in the app.`
        : `❌ Ship by **${who}** failed (exit ${code}).\n\`\`\`\n${errorTail(out)}\n\`\`\``;
      try { await channel?.send(msg); } catch (err) { console.error('could not post result:', err); }
    });
  } catch (err) {
    shipping = false;
    console.error(`[${stamp()}] handler error for ${tag}:`, err);
    try {
      const payload = { content: `❌ Ship error: ${err.message}`, flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch {}
  }
});

function errorTail(out) {
  const lines = out.split('\n').filter((l) => /error|fail|✗|❌|❗/i.test(l));
  return (lines.slice(-6).join('\n') || out.slice(-1200)).slice(0, 1200);
}

client.login(TOKEN);
