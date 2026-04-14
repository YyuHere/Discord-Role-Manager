import { Client, GatewayIntentBits, Partials } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ROLE_1_ID = process.env.ROLE_1_ID;
const ROLE_2_ID = process.env.ROLE_2_ID;

if (!DISCORD_BOT_TOKEN || !ROLE_1_ID || !ROLE_2_ID) {
  console.error('Missing environment variables: DISCORD_BOT_TOKEN, ROLE_1_ID, ROLE_2_ID');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message],
});

client.once('ready', () => {
  console.log(`Bot is online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const memberRoles = message.member?.roles?.cache;
  if (!memberRoles) return;

  const hasRole1 = memberRoles.has(ROLE_1_ID);

  if (!hasRole1) return;

  const mentionedRoles = message.mentions.roles;

  if (mentionedRoles.size === 0) return;

  const hasDisallowedMention = mentionedRoles.some(role => role.id !== ROLE_2_ID);

  if (hasDisallowedMention) {
    try {
      await message.delete();
      const warning = await message.channel.send(
        `${message.author}, أنت تقدر تعمل منشن لـ <@&${ROLE_2_ID}> فقط.`
      );
      setTimeout(() => warning.delete().catch(() => {}), 5000);
    } catch (err) {
      console.error('Error handling message:', err);
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
