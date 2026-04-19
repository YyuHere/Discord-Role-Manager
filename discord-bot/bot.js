import { Client, GatewayIntentBits, Partials, PermissionFlagsBits } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// --- الإعدادات العامة ---
const ANNOUNCEMENT_CHANNEL_ID = 'ضع_هنا_ID_الروم_المعينة'; 
const NOTIFICATIONS_ROLE_ID = 'ضع_هنا_ID_رول_الاشعارات';
const MUTE_ROLE_ID = '1493775095028645969';
// -----------------------

const ROLE_MENTION_MAP = {
  '1493317999418015914': '1492963034422050836',
  '1493318000848408606': '1493268166544195697',
  '1493318001468899490': '1493268285423354018',
  '1493656673938706442': '1493268335117209822',
  '1493317990286889010': '1492963182602354860',
  // تم الإصلاح هنا بوضع الـ 3 شاتات داخل [ ] وفواصل
  '1493318000181252107': ['1492963468431720635', '1492964255811506176', '1492963572983140504'],
  '1493658104297160857': '1493269153417527388',
  '1493657567073796148': '1493269488139899004',
  '1493657460811235500': '1493270221580931162',
};

const MUTE_DURATIONS_MINUTES = [0, 5, 10, 30, 60];
const linkViolations = new Map();
const nsfwViolations = new Map();
const URL_REGEX = /https?:\/\/\S+|discord\.gg\/\S+|www\.\S+\.\S+/gi;
const NSFW_KEYWORDS = ['nsfw', '+18', '18+', 'xxx', 'porn', 'sex', 'nude', 'naked'];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

async function applyProgressiveMute(message, violationsMap, reason, warningText) {
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;

  await message.delete().catch(() => {});
  const userId = message.author.id;
  const violations = (violationsMap.get(userId) || 0) + 1;
  violationsMap.set(userId, violations);

  const muteIndex = Math.min(violations - 1, MUTE_DURATIONS_MINUTES.length - 1);
  const muteDuration = MUTE_DURATIONS_MINUTES[muteIndex];

  if (muteDuration > 0) {
    await message.member.roles.add(MUTE_ROLE_ID, reason).catch(() => {});
    setTimeout(() => {
      message.member.roles.remove(MUTE_ROLE_ID, 'Expired').catch(() => {});
    }, muteDuration * 60 * 1000);
    const warning = await message.channel.send(`${warningText} Muted: **${muteDuration}m**.\n${message.author}`);
    setTimeout(() => warning.delete().catch(() => {}), 7000);
  } else {
    const warning = await message.channel.send(`${warningText}\n${message.author}`);
    setTimeout(() => warning.delete().catch(() => {}), 5000);
  }
  return true;
}

client.once('ready', () => {
  console.log(`Bot is online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const memberRoles = message.member?.roles?.cache;
  if (!memberRoles) return;

  // 1. فلاتر عامة (NSFW / Links)
  const contentLower = message.content.toLowerCase();
  if (message.attachments.size > 0 || message.stickers.size > 0 || NSFW_KEYWORDS.some(kw => contentLower.includes(kw))) {
    if (await applyProgressiveMute(message, nsfwViolations, 'NSFW', 'NSFW content is not allowed.')) return;
  }
  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    if (await applyProgressiveMute(message, linkViolations, 'Links', 'Links are not allowed.')) return;
  }

  // 2. نظام الروم المعينة (مسموح منشن رول واحد فقط)
  const mentionedRoles = message.mentions.roles;
  const hasEveryone = message.content.includes('@everyone') || message.content.includes('@here');

  if (message.channel.id === ANNOUNCEMENT_CHANNEL_ID) {
    if (mentionedRoles.size > 0 || hasEveryone || message.mentions.users.size > 0) {
      const isOnlyAllowedRole = mentionedRoles.size === 1 && mentionedRoles.has(NOTIFICATIONS_ROLE_ID) && !hasEveryone && message.mentions.users.size === 0;
      if (!isOnlyAllowedRole) {
        await message.delete().catch(() => {});
        const warn = await message.channel.send(`Only <@&${NOTIFICATIONS_ROLE_ID}> is allowed here!`);
        setTimeout(() => warn.delete().catch(() => {}), 5000);
        return;
      }
    }
  }

  // 3. نظام ROLE_MENTION_MAP (باقي الشاتات)
  if (mentionedRoles.size > 0) {
    for (const [sourceRoleId, allowed] of Object.entries(ROLE_MENTION_MAP)) {
      if (memberRoles.has(sourceRoleId)) {
        // تحويل المسموح لمصفوفة دايمًا عشان نعرف نقارن
        const allowedList = Array.isArray(allowed) ? allowed : [allowed];
        const hasDisallowed = mentionedRoles.some(role => !allowedList.includes(role.id));

        if (hasDisallowed) {
          await message.delete().catch(() => {});
          const warn = await message.channel.send(`You can only mention: ${allowedList.map(id => `<@&${id}>`).join(', ')}`);
          setTimeout(() => warn.delete().catch(() => {}), 5000);
          return;
        }

        // منع المنشن بدون نص
        if (message.content.replace(/<@&\d+>/g, '').trim().length === 0) {
          await message.delete().catch(() => {});
          const warn = await message.channel.send(`You must include a message with your mention.`);
          setTimeout(() => warn.delete().catch(() => {}), 5000);
          return;
        }
      }
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
