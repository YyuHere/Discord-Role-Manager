import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// Invite tracking cache
const invites = new Collection();

// الربط بين ID الروم و ID الرول المسموح بمنشنته في الروم دي
const CHANNEL_TO_ALLOWED_ROLE = {
  '1493272544252399648': '1492963034422050836',
  '1493272676603658310': '1493268166544195697',
  '1493272840265269469': '1493268285423354018',
  '1493272956527448276': '1493268335117209822',
  '1493273089356857354': '1492963182602354860',
  '1493273151570706668': '1492963468431720635','1492964255811506176','1492963572983140504'
  '1493273222664290385': '1493269153417527388',
  '1493334335497961642': '1493269488139899004',
  '1493273292704977051': '1493270221580931162',
};

const MUTE_DURATIONS_MINUTES = [0, 5, 10, 30, 60];
const MUTE_ROLE_ID = '1493775095028645969'; 
const WELCOME_CHANNEL_ID = '1495491723722494062'; 

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
    GatewayIntentBits.GuildInvites, 
  ],
  partials: [Partials.Message, Partials.Channel],
});

async function applyProgressiveMute(message, violationsMap, reason, warningText) {
  const canManageMessages = message.member.permissions.has(PermissionFlagsBits.ManageMessages);
  if (canManageMessages) return false;

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
    const warning = await message.channel.send(`${warningText} You have been muted for **${muteDuration} minutes**.\n\n${message.author}`);
    setTimeout(() => warning.delete().catch(() => {}), 7000);
  } else {
    const warning = await message.channel.send(`${warningText}\n\n${message.author}`);
    setTimeout(() => warning.delete().catch(() => {}), 5000);
  }
  return true;
}

client.once('ready', async () => {
  console.log(`Bot is online as ${client.user.tag}`);
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const guildInvites = await guild.invites.fetch();
      invites.set(guild.id, new Collection(guildInvites.map((invite) => [invite.code, invite.uses])));
    } catch (err) {}
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    const newInvites = await member.guild.invites.fetch();
    const oldInvites = invites.get(member.guild.id);
    const invite = newInvites.find(i => i.uses > (oldInvites ? (oldInvites.get(i.code) || 0) : 0));
    invites.set(member.guild.id, new Collection(newInvites.map((invite) => [invite.code, invite.uses])));
    const logChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (logChannel) {
      if (invite) {
        await logChannel.send(`✅ **${member}** joined the server!\n👤 Invited by: ${invite.inviter}\n📊 Total Invites: **${invite.uses}**`);
      } else {
        await logChannel.send(`✅ **${member}** joined the server! (Inviter unknown)`);
      }
    }
  } catch (err) {}
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // 1. منطق منشن الرولات بناءً على الروم (الطلب الأساسي)
  const allowedRoleId = CHANNEL_TO_ALLOWED_ROLE[message.channel.id];
  if (allowedRoleId) {
    const mentionedRoles = message.mentions.roles;
    if (mentionedRoles.size > 0) {
      // لو العضو منشن رول غير المسموح بيه في الروم دي
      const hasDisallowedMention = mentionedRoles.some(role => role.id !== allowedRoleId);
      if (hasDisallowedMention) {
        await message.delete().catch(() => {});
        const warning = await message.channel.send(`\u274C You can only mention <@&${allowedRoleId}> in this channel.\n\n${message.author}`);
        return setTimeout(() => warning.delete().catch(() => {}), 5000);
      }
    }
  }

  // 2. أمر فحص الدعوات
  if (message.content.startsWith('!invites')) {
    const target = message.mentions.members.first() || message.member;
    try {
      const guildInvites = await message.guild.invites.fetch();
      const userInvites = guildInvites.filter(i => i.inviter && i.inviter.id === target.id);
      let count = 0;
      userInvites.forEach(i => count += i.uses);
      return message.reply(`👤 **${target.user.tag}** currently has **${count}** invites.`);
    } catch (e) {}
  }

  // 3. فلاتر المحتوى (تم حذف فحص الصور والستيكرات هنا)
  const contentLower = message.content.toLowerCase();
  const hasNsfwKeyword = NSFW_KEYWORDS.some(kw => contentLower.includes(kw));

  if (hasNsfwKeyword) {
    await applyProgressiveMute(message, nsfwViolations, 'Sending NSFW content', '+18 content is not allowed.');
    return;
  }

  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    await applyProgressiveMute(message, linkViolations, 'Sending links', 'Links are not allowed.');
  }
  URL_REGEX.lastIndex = 0;
});

client.login(DISCORD_BOT_TOKEN);
