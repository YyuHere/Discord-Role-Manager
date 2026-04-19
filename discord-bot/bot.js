import { Client, GatewayIntentBits, Partials, PermissionFlagsBits } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// --- الإعدادات الجديدة ---
const ANNOUNCEMENT_CHANNEL_ID = 'ضع_هنا_ID_الروم_المعينة'; 
const NOTIFICATIONS_ROLE_ID = 'ضع_هنا_ID_رول_الاشعارات';
// -----------------------

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

const MUTE_DURATIONS_MINUTES = [0, 5, 10, 30, 60];
const MUTE_ROLE_ID = '1493775095028645969';

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
      message.member.roles.remove(MUTE_ROLE_ID, 'Mute duration expired').catch(() => {});
    }, muteDuration * 60 * 1000);
    const warning = await message.channel.send(
      `${warningText} You have been muted for **${muteDuration} minutes**.\n\n${message.author}`
    );
    setTimeout(() => warning.delete().catch(() => {}), 7000);
  } else {
    const warning = await message.channel.send(`${warningText}\n\n${message.author}`);
    setTimeout(() => warning.delete().catch(() => {}), 5000);
  }
  return true;
}

client.once('ready', () => {
  console.log(`Bot is online as ${client.user.tag}`);
  client.user.setPresence({
    status: 'idle',
    activities: [{ name: 'Helpr', type: 3 }],
  });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const memberRoles = message.member?.roles?.cache;
  if (!memberRoles) return;

  // 1. فلتر المحتوى +18
  const contentLower = message.content.toLowerCase();
  if (message.attachments.size > 0 || message.stickers.size > 0 || NSFW_KEYWORDS.some(kw => contentLower.includes(kw))) {
    if (await applyProgressiveMute(message, nsfwViolations, 'NSFW Content', '+18 content is not allowed here.')) return;
  }

  // 2. فلتر الروابط
  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    if (await applyProgressiveMute(message, linkViolations, 'Links Prohibited', 'Links are not allowed here.')) return;
  }

  // 3. فلتر المنشن (تعديلك المطلوب هنا)
  const mentionedRoles = message.mentions.roles;
  const mentionedUsers = message.mentions.users;
  const hasEveryone = message.content.includes('@everyone') || message.content.includes('@here');

  // --- المنطق الخاص بالروم المعينة ---
  if (message.channel.id === ANNOUNCEMENT_CHANNEL_ID) {
    // إذا وجد أي منشن (رول، شخص، أو everyone)
    if (mentionedRoles.size > 0 || mentionedUsers.size > 0 || hasEveryone) {
      // التحقق: هل المنشن الوحيد الموجود هو رول الإشعارات؟
      const isOnlyNotificationRole = mentionedRoles.size === 1 && mentionedRoles.has(NOTIFICATIONS_ROLE_ID) && mentionedUsers.size === 0 && !hasEveryone;

      if (!isOnlyNotificationRole) {
        try {
          await message.delete().catch(() => {});
          const warning = await message.channel.send(
            `في هذه الروم، مسموح فقط بمنشن <@&${NOTIFICATIONS_ROLE_ID}>.\n\n${message.author}`
          );
          setTimeout(() => warning.delete().catch(() => {}), 5000);
        } catch (err) {
          console.error('Error in specific channel check:', err.message);
        }
        return; 
      }
    }
  }

  // --- المنطق القديم (باقي الرومات) بناءً على ROLE_MENTION_MAP ---
  if (mentionedRoles.size > 0) {
    for (const [sourceRoleId, allowedTargetRoleId] of Object.entries(ROLE_MENTION_MAP)) {
      if (memberRoles.has(sourceRoleId)) {
        const hasDisallowedMention = mentionedRoles.some(role => role.id !== allowedTargetRoleId);
        if (hasDisallowedMention) {
          await message.delete().catch(() => {});
          const warning = await message.channel.send(`You are only allowed to mention <@&${allowedTargetRoleId}>.\n\n${message.author}`);
          setTimeout(() => warning.delete().catch(() => {}), 5000);
          return;
        }
        
        // منع المنشن بدون نص
        if (message.content.replace(/<@&\d+>/g, '').trim().length === 0) {
          await message.delete().catch(() => {});
          const warning = await message.channel.send(`You must include a message with your mention.\n\n${message.author}`);
          setTimeout(() => warning.delete().catch(() => {}), 5000);
          return;
        }
      }
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
