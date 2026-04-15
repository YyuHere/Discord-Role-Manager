import { Client, GatewayIntentBits, Partials } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// Map: رول اللي عنده صلاحية → الرول اللي مسموح يمنشنه بس
const ROLE_MENTION_MAP = {
  '1493272544252399648': '1493317999418015914',
  '1493272676603658310': '1493318000848408606',
  '1493272840265269469': '1493318001468899490',
  '1493272956527448276': '1493656673938706442',
  '1493273089356857354': '1493317990286889010',
  '1493273151570706668': '1493657567073796148',
  '1493273222664290385': '1493657460811235500',
  '1493334335497961642': '1493658104297160857',
  '1493273292704977051': '1493318000181252107',
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.once('clientReady', () => {
  console.log(`Bot is online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const memberRoles = message.member?.roles?.cache;
  if (!memberRoles) return;

  const mentionedRoles = message.mentions.roles;
  if (mentionedRoles.size === 0) return;

  // إيجاد أي رول من المنشن-ماب عند الشخص ده
  for (const [sourceRoleId, allowedTargetRoleId] of Object.entries(ROLE_MENTION_MAP)) {
    if (!memberRoles.has(sourceRoleId)) continue;

    // الشخص عنده الرول ده - نتحقق إن المنشن للرول المسموح بيه بس
    const hasDisallowedMention = mentionedRoles.some(role => role.id !== allowedTargetRoleId);

    if (hasDisallowedMention) {
      try {
        await message.delete();
        const warning = await message.channel.send(
          `${message.author}، أنت تقدر تعمل منشن لـ <@&${allowedTargetRoleId}> فقط.`
        );
        setTimeout(() => warning.delete().catch(() => {}), 5000);
      } catch (err) {
        console.error('Error handling message:', err.message);
      }
      return;
    }

    // المنشن مسموح، مفيش حاجة نعملها
    return;
  }
});

client.login(DISCORD_BOT_TOKEN);
