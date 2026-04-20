Import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection, ChannelType } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PREFIX = ''; 

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

const MUTE_ROLE_ID = '1493775095028645969';
const WELCOME_CHANNEL_ID = '1495491723722494062';

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
    } catch (err) {
      console.error(`Could not update permissions for channel: ${channel.name}`);
    }
  });
}

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

async function applyProgressiveMute(message, violationsMap, reason, warningText) {
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;

  await message.delete().catch(() => {});
  const userId = message.author.id;
  const violations = (violationsMap.get(userId) || 0) + 1;
  violationsMap.set(userId, violations);

  const muteIndex = Math.min(violations - 1, MUTE_DURATIONS_MINUTES.length - 1);
  const muteDuration = MUTE_DURATIONS_MINUTES[muteIndex];

  await message.member.roles.add(MUTE_ROLE_ID, reason).catch(() => {});
  
  const warning = await message.channel.send(`🔒 ${message.author}, ${warningText} You have been muted for **${muteDuration}m**.`);
  
  setTimeout(() => {
    message.member.roles.remove(MUTE_ROLE_ID, 'Mute Expired').catch(() => {});
  }, muteDuration * 60 * 1000);

  setTimeout(() => warning.delete().catch(() => {}), 7000);
  return true;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // --- Manual Mute Command ---
    if (command === 'mute') {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;

      const target = message.mentions.members.first();
      const duration = args[1]; 
      
      setTimeout(() => message.delete().catch(() => {}), 3000);

      if (!target) return message.reply('Please mention a user to mute.').then(m => setTimeout(() => m.delete(), 3000));
      if (!duration || !duration.endsWith('m')) return message.reply('Please specify time in minutes, e.g., `mute @user 10m`').then(m => setTimeout(() => m.delete(), 3000));

      const minutes = parseInt(duration);
      if (isNaN(minutes)) return message.reply('Invalid time format.').then(m => setTimeout(() => m.delete(), 3000));

      await setupMuteRolePermissions(message.guild); 
      await target.roles.add(MUTE_ROLE_ID).catch(e => console.error("Error adding role"));
      
      message.channel.send(`🔒 ${target} has been muted for **${minutes}** minutes.`);

      setTimeout(() => {
        if (target.roles.cache.has(MUTE_ROLE_ID)) {
          target.roles.remove(MUTE_ROLE_ID).catch(() => {});
          message.channel.send(`🔓 Mute expired for ${target}.`);
        }
      }, minutes * 60 * 1000);
      return;
    }

    // --- Manual Unmute Command ---
    if (command === 'unmute') {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const target = message.mentions.members.first();
      
      setTimeout(() => message.delete().catch(() => {}), 3000);

      if (!target) return message.reply('Please mention a user.').then(m => setTimeout(() => m.delete(), 3000));

      await target.roles.remove(MUTE_ROLE_ID).catch(e => console.error("Error removing role"));
      message.channel.send(`🔓 ${target} has been unmuted.`);
      return;
    }

    // --- Manual Clear Command ---
    if (command === 'clear' || command === 'مسح') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

      const amount = parseInt(args[0]);

      if (isNaN(amount)) {
        return message.reply('Please specify the number of messages to clear. Example: `clear 10`').then(m => setTimeout(() => m.delete(), 4000));
      }

      if (amount <= 0 || amount > 100) {
        return message.reply('You can only clear between 1 and 100 messages.').then(m => setTimeout(() => m.delete(), 4000));
      }

      try {
        await message.delete(); // حذف رسالة الأمر أولاً
        const deleted = await message.channel.bulkDelete(amount, true);
        const successMsg = await message.channel.send(`✅ Successfully cleared **${deleted.size}** messages.`);
        setTimeout(() => successMsg.delete().catch(() => {}), 5000);
      } catch (err) {
        console.error(err);
        message.channel.send('An error occurred while trying to clear messages (Messages older than 14 days cannot be bulk deleted).').then(m => setTimeout(() => m.delete(), 5000));
      }
      return;
    }
  }

  // --- Auto-Protection Systems ---
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const userId = message.author.id;
  const now = Date.now();

  if (!messageLog.has(userId)) messageLog.set(userId, []);
  const userData = messageLog.get(userId);
  userData.push({ timestamp: now, content: message.content });

  const recentMessages = userData.filter(msg => now - msg.timestamp < SPAM_INTERVAL);
  messageLog.set(userId, recentMessages);

  const duplicateMessages = recentMessages.filter(msg => msg.content === message.content);
  
  if (duplicateMessages.length >= 3 || recentMessages.length >= SPAM_THRESHOLD) {
    if (await applyProgressiveMute(message, spamViolations, 'Anti-Spam', 'Please stop spamming!')) {
      messageLog.delete(userId);
      return;
    }
  }

  const contentLower = message.content.toLowerCase();
  if (NSFW_KEYWORDS.some(kw => contentLower.includes(kw))) {
    if (await applyProgressiveMute(message, nsfwViolations, 'NSFW Content', 'Inappropriate content is not allowed!')) return;
  }

  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    if (await applyProgressiveMute(message, linkViolations, 'External Links', 'Links are not allowed here!')) return;
  }

  const mentionedRoles = message.mentions.roles;
  const hasEveryone = message.content.includes('@everyone') || message.content.includes('@here');

  if (mentionedRoles.size > 0 || hasEveryone) {
    let isViolation = true;
    for (const [mRoleId] of mentionedRoles) {
      if (ROLE_MENTION_MAP[mRoleId]) {
        const allowedChannels = ROLE_MENTION_MAP[mRoleId];
        const allowedChannelsList = Array.isArray(allowedChannels) ? allowedChannels : [allowedChannels];
        if (allowedChannelsList.includes(message.channel.id) && message.member.roles.cache.has(mRoleId)) {
          isViolation = false; 
        }
      }
    }
    if (isViolation || hasEveryone) {
      await message.delete().catch(() => {});
      const warn = await message.channel.send(`${message.author}, you cannot mention this role in this channel!`);
      setTimeout(() => warn.delete().catch(() => {}), 5000);
    }
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
    if (invite) {
      welcomeChannel.send(`Welcome ${member}! Joined via: <@${invite.inviter.id}>. Total invites: **${invite.uses}**`);
    } else {
      welcomeChannel.send(`Welcome ${member}! Just joined the server.`);
    }
  } catch (err) {
    console.error('Error tracking invite:', err);
  }
});

client.login(DISCORD_BOT_TOKEN); 
