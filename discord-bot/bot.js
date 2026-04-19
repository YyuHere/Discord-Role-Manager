import { Client, GatewayIntentBits, Partials, PermissionFlagsBits } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// رتبة الكتم
const MUTE_ROLE_ID = '1493775095028645969';
// ---------------------------------------------------


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

  // 1. الفلاتر العامة
  const contentLower = message.content.toLowerCase();
  if (message.attachments.size > 0 || message.stickers.size > 0 || NSFW_KEYWORDS.some(kw => contentLower.includes(kw))) {
    if (await applyProgressiveMute(message, nsfwViolations, 'NSFW', 'NSFW content is not allowed.')) return;
  }
  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    if (await applyProgressiveMute(message, linkViolations, 'Links', 'Links are not allowed.')) return;
  }

  // 2. فحص الروم المعينة (شات الإشعارات)
  const mentionedRoles = message.mentions.roles;
  const hasEveryone = message.content.includes('@everyone') || message.content.includes('@here');

  if (message.channel.id === ANNOUNCEMENT_CHANNEL_ID) {
    if (mentionedRoles.size > 0 || hasEveryone || message.mentions.users.size > 0) {
      // السماح فقط بمنشن رول الإشعارات المحدد فوق
      const isOnlyAllowedNotif = mentionedRoles.size === 1 && mentionedRoles.has(NOTIFICATIONS_ROLE_ID) && !hasEveryone && message.mentions.users.size === 0;
      
      if (!isOnlyAllowedNotif) {
        await message.delete().catch(() => {});
        const warn = await message.channel.send(`في هذه الروم، مسموح فقط بمنشن <@&${NOTIFICATIONS_ROLE_ID}>!`);
        setTimeout(() => warn.delete().catch(() => {}), 5000);
        return;
      }
    }
  }

  // 3. فحص الصلاحيات بناءً على الخريطة (بقية الشاتات)
  if (mentionedRoles.size > 0) {
    for (const [sourceRoleId, allowedChannels] of Object.entries(ROLE_MENTION_MAP)) {
      if (memberRoles.has(sourceRoleId)) {
        // التأكد من أن الشات الحالي هو ضمن الشاتات المسموحة لهذا الرول
        const allowedChannelsList = Array.isArray(allowedChannels) ? allowedChannels : [allowedChannels];
        
        // إذا كان يحاول المنشن في شات مش بتاعه
        if (!allowedChannelsList.includes(message.channel.id)) {
            // هنا ممكن تمسح الرسالة لو مش عاوزة يمنشن في شاتات غريبة
            await message.delete().catch(() => {});
            const warn = await message.channel.send(`هذا الرول مسموح له بالمنشن في شاتات معينة فقط.`);
            setTimeout(() => warn.delete().catch(() => {}), 5000);
            return;
        }

        // منع المنشن بدون نص
        if (message.content.replace(/<@&\d+>/g, '').trim().length === 0) {
          await message.delete().catch(() => {});
          const warn = await message.channel.send(`يجب كتابة رسالة مع المنشن.`);
          setTimeout(() => warn.delete().catch(() => {}), 5000);
          return;
        }
      }
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
