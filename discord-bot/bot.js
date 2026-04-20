import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection, ChannelType } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PREFIX = ''; 

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// --- إعداد الـ 9 مجموعات المربوطة (اربط كل شيء هنا) ---
const PERMISSIONS_CONFIG = [
  { userRoleId: '1493273222664290385', channelId: '1493270221580931162', targetRoleId: '1493657460811235500' },
  { userRoleId: 'ID_2', channelId: 'CH_2', targetRoleId: 'TARGET_2' },
  { userRoleId: 'ID_3', channelId: 'CH_3', targetRoleId: 'TARGET_3' },
  { userRoleId: 'ID_4', channelId: 'CH_4', targetRoleId: 'TARGET_4' },
  { userRoleId: 'ID_5', channelId: 'CH_5', targetRoleId: 'TARGET_5' },
  { userRoleId: 'ID_6', channelId: 'CH_6', targetRoleId: 'TARGET_6' },
  { userRoleId: 'ID_7', channelId: 'CH_7', targetRoleId: 'TARGET_7' },
  { userRoleId: 'ID_8', channelId: 'CH_8', targetRoleId: 'TARGET_8' },
  { userRoleId: 'ID_9', channelId: 'CH_9', targetRoleId: 'TARGET_9' },
];

const MUTE_ROLE_ID = '1493775095028645969';
const WELCOME_CHANNEL_ID = '1495491723722494062';

const spamViolations = new Map();
const messageLog = new Map();
const MUTE_DURATIONS_MINUTES = [5, 10, 30, 60, 1440];
const SPAM_THRESHOLD = 4;
const SPAM_INTERVAL = 5000;
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

async function setupMuteRolePermissions(guild) {
  const muteRole = guild.roles.cache.get(MUTE_ROLE_ID);
  if (!muteRole) return;
  guild.channels.cache.forEach(async (channel) => {
    try {
      await channel.permissionOverwrites.edit(muteRole, {
        SendMessages: false,
        AddReactions: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
      });
    } catch (err) { console.error(`Error permissions: ${channel.name}`); }
  });
}

client.once('ready', async () => {
  console.log(`Bot is online as ${client.user.tag}`);
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const guildInvites = await guild.invites.fetch();
      invites.set(guildId, new Collection(guildInvites.map((inv) => [inv.code, inv.uses])));
    } catch (err) { console.log(`Invite fetch error: ${guildId}`); }
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
  await message.member.roles.add(MUTE_ROLE_ID, reason).catch(() => {});
  const warning = await message.channel.send(`🔒 ${message.author}, ${warningText} Muted for **${muteDuration}m**.`);
  setTimeout(() => { message.member.roles.remove(MUTE_ROLE_ID).catch(() => {}); }, muteDuration * 60 * 1000);
  setTimeout(() => warning.delete().catch(() => {}), 7000);
  return true;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // --- [1] نظام المنشن المربوط (الـ 9 مجموعات) ---
  const matchedGroup = PERMISSIONS_CONFIG.find(group => 
    message.channel.id === group.channelId && 
    message.member.roles.cache.has(group.userRoleId) && 
    message.content.includes(`<@&${group.targetRoleId}>`)
  );

  if (matchedGroup) {
    try {
      const roleToEnable = message.guild.roles.cache.get(matchedGroup.targetRoleId);
      if (roleToEnable) {
        await roleToEnable.setMentionable(true, 'Temporary Open');
        setTimeout(async () => {
          await roleToEnable.setMentionable(false).catch(() => {});
        }, 3000);
      }
    } catch (err) { console.error('Mention error:', err); }
  }

  // --- [2] نظام الأوامر (Commands) ---
  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'mute') {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const target = message.mentions.members.first();
      const duration = args[1];
      if (!target || !duration) return;
      const minutes = parseInt(duration);
      await target.roles.add(MUTE_ROLE_ID).catch(() => {});
      message.channel.send(`🔒 ${target} muted for ${minutes}m.`);
      setTimeout(() => { target.roles.remove(MUTE_ROLE_ID).catch(() => {}); }, minutes * 60 * 1000);
      return;
    }

    if (command === 'unmute') {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const target = message.mentions.members.first();
      if (!target) return;
      await target.roles.remove(MUTE_ROLE_ID).catch(() => {});
      message.channel.send(`🔓 ${target} unmuted.`);
      return;
    }

    if (command === 'clear' || command === 'مسح') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
      const amount = parseInt(args[0]);
      if (isNaN(amount) || amount <= 0 || amount > 100) return;
      await message.delete();
      await message.channel.bulkDelete(amount, true);
      return;
    }
  }

  // --- [3] أنظمة الحماية التلقائية ---
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const userId = message.author.id;
  const now = Date.now();
  if (!messageLog.has(userId)) messageLog.set(userId, []);
  const userData = messageLog.get(userId);
  userData.push({ timestamp: now, content: message.content });
  const recentMessages = userData.filter(msg => now - msg.timestamp < SPAM_INTERVAL);
  messageLog.set(userId, recentMessages);

  if (recentMessages.filter(msg => msg.content === message.content).length >= 3 || recentMessages.length >= SPAM_THRESHOLD) {
    if (await applyProgressiveMute(message, spamViolations, 'Anti-Spam', 'Stop spamming!')) return;
  }

  if (NSFW_KEYWORDS.some(kw => message.content.toLowerCase().includes(kw))) {
    if (await applyProgressiveMute(message, nsfwViolations, 'NSFW', 'No NSFW!')) return;
  }

  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    if (await applyProgressiveMute(message, linkViolations, 'Links', 'No links!')) return;
  }
});

client.on('inviteCreate', (invite) => {
  const guildInvites = invites.get(invite.guild.id);
  if (guildInvites) guildInvites.set(invite.code, invite.uses);
});

client.on('guildMemberAdd', async (member) => {
  const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (!welcomeChannel) return;
  try {
    const newInvites = await member.guild.invites.fetch();
    const oldInvites = invites.get(member.guild.id);
    const invite = newInvites.find(i => i.uses > (oldInvites?.get(i.code) || 0));
    invites.set(member.guild.id, new Collection(newInvites.map(i => [i.code, i.uses])));
    welcomeChannel.send(invite ? `Welcome ${member}! Inviter: <@${invite.inviter.id}>.` : `Welcome ${member}!`);
  } catch (err) { console.error(err); }
});

client.login(DISCORD_BOT_TOKEN);
