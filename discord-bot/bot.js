import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// Cache and Tracking Maps
const invites = new Collection();
const spamTrack = new Map(); 
const spamViolations = new Map(); 
const linkViolations = new Map();
const nsfwViolations = new Map();

// Configuration
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
const WELCOME_CHANNEL_ID = '1495491723722494062'; 

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
    setTimeout(() => warning.delete().catch(() => {}));
  }
  return true;
}

client.once('ready', async () => {
  console.log(`Bot is online as ${client.user.tag}`);
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const guildInvites = await guild.invites.fetch();
      invites.set(guild.id, new Collection(guildInvites.map((invite) => [invite.code, invite.uses])));
    } catch (err) {
      console.error(`Couldn't fetch invites for guild ${guild.id}`);
    }
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
        await logChannel.send(`✅ **${member}** joined!\n👤 Invited by: ${invite.inviter}\n📊 Total Invites: **${invite.uses}**`);
      } else {
        await logChannel.send(`✅ **${member}** joined! (Inviter unknown)`);
      }
    }
  } catch (err) {}
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const member = message.member;
  if (!member) return;

  // 1. Anti-Spam Logic (Excludes Administrators)
  if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
    const now = Date.now();
    const userData = spamTrack.get(message.author.id) || { lastMsg: 0, count: 0 };
    if (now - userData.lastMsg < 1000) { 
      userData.count++;
    } else {
      userData.count = 1;
    }
    userData.lastMsg = now;
    spamTrack.set(message.author.id, userData);

    if (userData.count >= 4) { 
      await applyProgressiveMute(message, spamViolations, 'Spamming', 'Stop spamming!');
      return;
    }
  }

  // 2. !mmute Command (Admin Only)
  if (message.content.startsWith('!mmute')) {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply("Please mention a user to mute.");
    await target.roles.add(MUTE_ROLE_ID, 'Manual mute by admin');
    return message.channel.send(`🤐 ${target} has been muted by Admin.`);
  }

  // 3. !uunmute Command (Admin Only)
  if (message.content.startsWith('!uunmute')) {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply("Please mention a user to unmute.");
    await target.roles.remove(MUTE_ROLE_ID, 'Unmute by admin');
    return message.channel.send(`🔊 ${target} has been unmuted.`);
  }

  // 4. !invites Command
  if (message.content.startsWith('!invites')) {
    const target = message.mentions.members.first() || message.member;
    const guildInvites = await message.guild.invites.fetch();
    const userInvites = guildInvites.filter(i => i.inviter && i.inviter.id === target.id);
    let count = 0;
    userInvites.forEach(i => count += i.uses);
    return message.reply(`👤 **${target.user.tag}** has **${count}** invites.`);
  }

  // 5. Text Filters (Links & NSFW Keywords - Photos are now allowed)
  const contentLower = message.content.toLowerCase();
  const hasNsfwKeyword = NSFW_KEYWORDS.some(kw => contentLower.includes(kw));
  if (hasNsfwKeyword) {
    await applyProgressiveMute(message, nsfwViolations, 'NSFW content', '+18 content is not allowed.');
  }

  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    await applyProgressiveMute(message, linkViolations, 'Links', 'Links are not allowed.');
  }
});

client.login(DISCORD_BOT_TOKEN);
