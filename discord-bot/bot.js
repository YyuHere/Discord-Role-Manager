import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// تخزين الدعوات مؤقتاً في الذاكرة
const invites = new Collection();

// Map: رول اللي عنده صلاحية ← الرول اللي مسموح يمنشنه بس
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
const MUTE_ROLE_ID = '1495491723722494062';
const WELCOME_CHANNEL_ID = 'رقم_الروم_هنا'; // ضع هنا ID روم الترحيب/اللوج

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
    GatewayIntentBits.GuildInvites, // مهم جداً لنظام الدعوات
  ],
  partials: [Partials.Message, Partials.Channel],
});

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
    const warning = await message.channel.send(`${warningText} You have been muted for **${muteDuration} minutes**.\n\n${message.author}`);
    setTimeout(() => warning.delete().catch(() => {}), 7000);
  } else {
    const warning = await message.channel.send(`${warningText}\n\n${message.author}`);
    setTimeout(() => warning.delete().catch(() => {}), 5000);
  }
  return true;
}

// جلب الدعوات عند تشغيل البوت
client.once('ready', async () => {
  console.log(`Bot is online as ${client.user.tag}`);
  
  client.guilds.cache.forEach(async (guild) => {
    try {
      const firstInvites = await guild.invites.fetch();
      invites.set(guild.id, new Collection(firstInvites.map((invite) => [invite.code, invite.uses])));
    } catch (err) {
      console.error(`Couldn't fetch invites for guild ${guild.id}`);
    }
  });

  client.user.setPresence({
    status: 'idle',
    activities: [{ name: 'Helpr', type: 3 }],
  });
});

// نظام تتبع من قام بالدعوة
client.on('guildMemberAdd', async (member) => {
  try {
    const newInvites = await member.guild.invites.fetch();
    const oldInvites = invites.get(member.guild.id);
    const invite = newInvites.find(i => i.uses > (oldInvites.get(i.code) || 0));
    
    // تحديث الكاش بالقيم الجديدة
    invites.set(member.guild.id, new Collection(newInvites.map((invite) => [invite.code, invite.uses])));

    const logChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (logChannel) {
      if (invite) {
        logChannel.send(`✅ **${member.user.tag}** انضم للسيرفر!\n👤 بواسطة: **${invite.inviter.tag}**\n📊 عدد دعواته الحالية: **${invite.uses}**`);
      } else {
        logChannel.send(`✅ **${member.user.tag}** انضم للسيرفر (غير معروف من دعاه).`);
      }
    }
  } catch (err) {
    console.error('Error in guildMemberAdd invite tracking:', err);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const memberRoles = message.member?.roles?.cache;
  if (!memberRoles) return;

  // أمر فحص عدد الدعوات الشخصي
  if (message.content.startsWith('!invites')) {
    const target = message.mentions.members.first() || message.member;
    const guildInvites = await message.guild.invites.fetch();
    const userInvites = guildInvites.filter(i => i.inviter && i.inviter.id === target.id);
    let count = 0;
    userInvites.forEach(i => count += i.uses);
    return message.reply(`👤 **${target.user.tag}** لديه **${count}** دعوة حالياً.`);
  }

  // ===== فلتر المحتوى +18 =====
  const hasAttachment = message.attachments.size > 0;
  const hasSticker = message.stickers.size > 0;
  const contentLower = message.content.toLowerCase();
  const hasNsfwKeyword = NSFW_KEYWORDS.some(kw => contentLower.includes(kw));

  if (hasAttachment || hasSticker || hasNsfwKeyword) {
    try {
      const handled = await applyProgressiveMute(message, nsfwViolations, 'Sending +18 content', '+18 content is not allowed here.');
      if (handled) return;
    } catch (err) {
      console.error('Error handling NSFW content:', err.message);
    }
  }

  // ===== فلتر الروابط =====
  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    try {
      const handled = await applyProgressiveMute(message, linkViolations, 'Sending links', 'Links are not allowed here.');
      if (handled) return;
    } catch (err) {
      console.error('Error handling link:', err.message);
    }
  }
  URL_REGEX.lastIndex = 0;

  // ===== فلتر المنشن =====
  const mentionedRoles = message.mentions.roles;
  if (mentionedRoles.size > 0) {
    for (const [sourceRoleId, allowedTargetRoleId] of Object.entries(ROLE_MENTION_MAP)) {
      if (!memberRoles.has(sourceRoleId)) continue;

      const hasDisallowedMention = mentionedRoles.some(role => role.id !== allowedTargetRoleId);
      if (hasDisallowedMention) {
        await message.delete().catch(() => {});
        const warning = await message.channel.send(`You are only allowed to mention <@&${allowedTargetRoleId}>.\n\n${message.author}`);
        return setTimeout(() => warning.delete().catch(() => {}), 5000);
      }

      const textOnly = message.content.replace(/<@&\d+>/g, '').trim();
      if (textOnly.length === 0) {
        await message.delete().catch(() => {});
        const warning = await message.channel.send(`You must include a message with your mention.\n\n${message.author}`);
        return setTimeout(() => warning.delete().catch(() => {}), 5000);
      }
      return;
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
