import { Client, GatewayIntentBits, Partials, PermissionFlagsBits } from 'discord.js';

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

// مدد الكتم التدريجية بالدقائق: مخالفة 1 = حذف بس، 2 = 5 دقائق، 3 = 10، 4 = 30، 5+ = 60
const MUTE_DURATIONS_MINUTES = [0, 5, 10, 30, 60];

const MUTE_ROLE_ID = '1493775095028645969';

// تتبع مخالفات الروابط لكل يوزر
const linkViolations = new Map();

// تتبع مخالفات المحتوى +18 لكل يوزر
const nsfwViolations = new Map();

const URL_REGEX = /https?:\/\/\S+|discord\.gg\/\S+|www\.\S+\.\S+/gi;

// كلمات مفتاحية للمحتوى الصريح
const NSFW_KEYWORDS = [
  'nsfw', '+18', '18+', 'xxx', 'porn', 'sex', 'nude', 'naked',
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// دالة مشتركة لتطبيق الميوت التدريجي
async function applyProgressiveMute(message, violationsMap, reason, warningText) {
  const canManageMessages = message.member.permissions.has(PermissionFlagsBits.ManageMessages);
  if (canManageMessages) return false;

  await message.delete();

  const userId = message.author.id;
  const violations = (violationsMap.get(userId) || 0) + 1;
  violationsMap.set(userId, violations);

  const muteIndex = Math.min(violations - 1, MUTE_DURATIONS_MINUTES.length - 1);
  const muteDuration = MUTE_DURATIONS_MINUTES[muteIndex];

  if (muteDuration > 0) {
    await message.member.roles.add(MUTE_ROLE_ID, reason);
    setTimeout(() => {
      message.member.roles.remove(MUTE_ROLE_ID, 'Mute duration expired').catch(() => {});
    }, muteDuration * 60 * 1000);
    const warning = await message.channel.send(
      `${warningText} You have been muted for **${muteDuration} minutes**.\n\n${message.author}`
    );
    setTimeout(() => warning.delete().catch(() => {}), 7000);
  } else {
    const warning = await message.channel.send(
      `${warningText}\n\n${message.author}`
    );
    setTimeout(() => warning.delete().catch(() => {}), 5000);
  }

  return true;
}

client.once('clientReady', () => {
  console.log(`Bot is online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const memberRoles = message.member?.roles?.cache;
  if (!memberRoles) return;

  // ===== فلتر المحتوى +18 (صور، ستيكرات، ملفات، كلمات صريحة) =====
  const hasAttachment = message.attachments.size > 0;
  const hasSticker = message.stickers.size > 0;
  const contentLower = message.content.toLowerCase();
  const hasNsfwKeyword = NSFW_KEYWORDS.some(kw => contentLower.includes(kw));

  if (hasAttachment || hasSticker || hasNsfwKeyword) {
    try {
      const handled = await applyProgressiveMute(
        message,
        nsfwViolations,
        'Sending +18 content is not allowed',
        '+18 content is not allowed here.'
      );
      if (handled) return;
    } catch (err) {
      console.error('Error handling NSFW content:', err.message);
      return;
    }
  }

  // ===== فلتر الروابط =====
  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    try {
      const handled = await applyProgressiveMute(
        message,
        linkViolations,
        'Sending links is not allowed',
        'Links are not allowed here.'
      );
      if (handled) return;
    } catch (err) {
      console.error('Error handling link:', err.message);
      return;
    }
  }
  URL_REGEX.lastIndex = 0;

  // ===== فلتر المنشن =====
  const mentionedRoles = message.mentions.roles;
  if (mentionedRoles.size === 0) return;

  for (const [sourceRoleId, allowedTargetRoleId] of Object.entries(ROLE_MENTION_MAP)) {
    if (!memberRoles.has(sourceRoleId)) continue;

    const hasDisallowedMention = mentionedRoles.some(role => role.id !== allowedTargetRoleId);

    if (hasDisallowedMention) {
      try {
        await message.delete();
        const warning = await message.channel.send(
          `You are only allowed to mention <@&${allowedTargetRoleId}>.\n\n${message.author}`
        );
        setTimeout(() => warning.delete().catch(() => {}), 5000);
      } catch (err) {
        console.error('Error handling mention:', err.message);
      }
      return;
    }

    // المنشن مسموح - نتحقق إن في نص مع المنشن
    const textOnly = message.content.replace(/<@&\d+>/g, '').trim();
    if (textOnly.length === 0) {
      try {
        await message.delete();
        const warning = await message.channel.send(
          `You must include a message with your mention.\n\n${message.author}`
        );
        setTimeout(() => warning.delete().catch(() => {}), 5000);
      } catch (err) {
        console.error('Error handling mention:', err.message);
      }
    }
    return;
  }
});

client.login(DISCORD_BOT_TOKEN);
