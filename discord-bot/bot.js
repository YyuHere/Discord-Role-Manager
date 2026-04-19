import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// إعدادات القنوات والرواتب
const MUTE_ROLE_ID = '1493775095028645969';
const WELCOME_CHANNEL_ID = '1495491723722494062'; // تأكد من وضع ID القناة الصحيح هنا

const ROLE_MENTION_MAP = {
  '1493317999418015914': '1492963034422050836',
  '1493318000848408606': '1493268166544195697',
  '1493318001468899490': '1493268285423354018',
  '1493656673938706442': '1493268335117209822',
  '1493317990286889010': '1492963182602354860',
  '1493318000181252107': ['1492963572983140504', '1492964255811506176', '1492963468431720635'],
  '1493658104297160857': '1493269153417527388',
  '1493657567073796148': '1493269488139899004',
  '1493657460811235500': '1493270221580931162',
};

const MUTE_DURATIONS_MINUTES = [0, 5, 10, 30, 60];
const linkViolations = new Map();
const nsfwViolations = new Map();
const URL_REGEX = /https?:\/\/\S+|discord\.gg\/\S+|www\.\S+\.\S+/gi;
const NSFW_KEYWORDS = ['nsfw', '+18', '18+', 'xxx', 'porn', 'sex', 'nude', 'naked'];

const invites = new Collection();

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

client.once('ready', async () => {
  console.log(`Bot is online as ${client.user.tag}`);
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const guildInvites = await guild.invites.fetch();
      invites.set(guildId, new Collection(guildInvites.map((inv) => [inv.code, inv.uses])));
    } catch (err) {
      console.log(`Could not fetch invites for guild: ${guildId}`);
    }
  }
});

client.on('inviteCreate', (invite) => {
  const guildInvites = invites.get(invite.guild.id);
  if (guildInvites) guildInvites.set(invite.code, invite.uses);
});

// --- التعديل هنا لعمل المنشن ---
client.on('guildMemberAdd', async (member) => {
  const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (!welcomeChannel) return;

  try {
    const newInvites = await member.guild.invites.fetch();
    const oldInvites = invites.get(member.guild.id);
    
    const invite = newInvites.find(i => i.uses > (oldInvites?.get(i.code) || 0));
    
    invites.set(member.guild.id, new Collection(newInvites.map(i => [i.code, i.uses])));

    if (invite) {
      const inviter = invite.inviter;
      // استخدام <@ID> لعمل منشن مباشر وصحيح
      welcomeChannel.send(`Welcome <@${member.id}>! تم دخول الشخص من طرف: <@${inviter.id}>\nعدد دعواته الآن: **${invite.uses}**`);
    } else {
      welcomeChannel.send(`Welcome <@${member.id}>! انضم الشخص للسيرفر.`);
    }
  } catch (err) {
    console.error('Error tracking invite:', err);
  }
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
      message.member.roles.remove(MUTE_ROLE_ID, 'Mute Expired').catch(() => {});
    }, muteDuration * 60 * 1000);
    const warning = await message.channel.send(`${message.author}, ${warningText} You have been muted for **${muteDuration}m**.`);
    setTimeout(() => warning.delete().catch(() => {}), 7000);
  } else {
    const warning = await message.channel.send(`${message.author}, ${warningText}`);
    setTimeout(() => warning.delete().catch(() => {}), 5000);
  }
  return true;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const memberRoles = message.member?.roles?.cache;
  if (!memberRoles) return;

  const contentLower = message.content.toLowerCase();

  if (NSFW_KEYWORDS.some(kw => contentLower.includes(kw))) {
    if (await applyProgressiveMute(message, nsfwViolations, 'NSFW Content', 'NSFW content is not allowed here.')) return;
  }

  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    if (await applyProgressiveMute(message, linkViolations, 'External Links', 'Posting links is not allowed here.')) return;
  }

  const mentionedRoles = message.mentions.roles;
  const hasEveryone = message.content.includes('@everyone') || message.content.includes('@here');

  if (mentionedRoles.size > 0 || hasEveryone) {
    if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    let isViolation = true;

    for (const [mRoleId] of mentionedRoles) {
      if (ROLE_MENTION_MAP[mRoleId]) {
        if (memberRoles.has(mRoleId)) {
          const allowedChannels = ROLE_MENTION_MAP[mRoleId];
          const allowedChannelsList = Array.isArray(allowedChannels) ? allowedChannels : [allowedChannels];

          if (allowedChannelsList.includes(message.channel.id)) {
            isViolation = false; 
          }
        }
      }
    }

    if (isViolation || hasEveryone) {
      await message.delete().catch(() => {});
      const warn = await message.channel.send(`${message.author}, you are only allowed to mention your assigned role within its designated channel!`);
      setTimeout(() => warn.delete().catch(() => {}), 5000);
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
