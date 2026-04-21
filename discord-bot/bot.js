import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection, ChannelType, EmbedBuilder } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PREFIX = '!'; 

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// Array to store active giveaways in memory
let activeGiveaways = [];

// --- [1] Basic Configuration ---
const AUTO_ROLE_ID = '1495910705172578364'; 
const MUTE_ROLE_ID = '1493775095028645969';
const WELCOME_CHANNEL_ID = '1495491723722494062';

const PERMISSIONS_CONFIG = [
  { userRoleId: '1493273222664290385', channelId: '1493270221580931162', targetRoleId: '1493657460811235500' },
  { userRoleId: '1493272544252399648', channelId: '1492963034422050836', targetRoleId: '1493317999418015914' },
  { userRoleId: '1493272676603658310', channelId: '1493268166544195697', targetRoleId: '1493318000848408606' },
  { userRoleId: '1493272840265269469', channelId: '1493268285423354018', targetRoleId: '1493318001468899490' },
  { userRoleId: '1493272956527448276', channelId: '1493268335117209822', targetRoleId: '1493656673938706442' },
  { userRoleId: '1493273089356857354', channelId: '1492963182602354860', targetRoleId: '1493317990286889010' },
  { userRoleId: '1493334335497961642', channelId: '1493269488139899004', targetRoleId: '1493658104297160857' },
  { userRoleId: '1493273151570706668', channelId: '1493269488139899004', targetRoleId: '1493657567073796148' },
  { userRoleId: '1493273292704977051', channelId: '1492963468431720635', targetRoleId: '1493318000181252107' },
  { userRoleId: '1493273292704977051', channelId: '1492964255811506176', targetRoleId: '1493318000181252107' },
  { userRoleId: '1493273292704977051', channelId: '1492963572983140504', targetRoleId: '1493318000181252107' },
];

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
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// --- Function to end giveaway and pick winners ---
async function finishGiveaway(giveaway) {
    try {
      const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
      if (!channel) return;

      const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
      if (!message) return;

      const reaction = message.reactions.cache.get('🎉');
      if (!reaction) return channel.send(`The giveaway for **${giveaway.prize}** ended, but no reactions were found.`);

      const users = await reaction.users.fetch();
      const candidates = users.filter(u => !u.bot).map(u => u);

      if (candidates.length === 0) {
        return channel.send(`The giveaway for **${giveaway.prize}** ended, but no one participated.`);
      }

      const winners = [];
      for (let i = 0; i < Math.min(giveaway.winnerCount, candidates.length); i++) {
        const index = Math.floor(Math.random() * candidates.length);
        winners.push(candidates.splice(index, 1)[0]);
      }

      const winnerMentions = winners.map(w => `<@${w.id}>`).join(', ');
      channel.send(`🎉 Congratulations ${winnerMentions}! You won **${giveaway.prize}**!`);

      const finalEmbed = EmbedBuilder.from(message.embeds[0])
        .setDescription(`**Prize:** ${giveaway.prize}\n**Winners:** ${winnerMentions}`)
        .setFooter({ text: 'Giveaway Ended' });
      
      await message.edit({ embeds: [finalEmbed] });
    } catch (err) {
      console.error('Error in finishGiveaway:', err);
    }
}

client.once('ready', async () => {
  console.log(`Bot is online as ${client.user.tag}`);
  
  // Periodic check system: runs every 30 seconds to check for giveaway expiration
  setInterval(async () => {
    const now = Date.now();
    for (const giveaway of activeGiveaways) {
      if (now >= giveaway.endAt && !giveaway.ended) {
        giveaway.ended = true;
        await finishGiveaway(giveaway);
      }
    }
    // Remove ended giveaways from the list
    activeGiveaways = activeGiveaways.filter(g => !g.ended);
  }, 30000);

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const guildInvites = await guild.invites.fetch();
      invites.set(guildId, new Collection(guildInvites.map((inv) => [inv.code, inv.uses])));
    } catch (err) { console.log(`Invite fetch error for guild: ${guildId}`); }
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
    setTimeout(() => { message.member.roles.remove(MUTE_ROLE_ID, 'Mute Expired').catch(() => {}); }, muteDuration * 60 * 1000);
    setTimeout(() => warning.delete().catch(() => {}), 7000);
    return true;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // -- Invite Check Command --
    if (command === 'invites') {
        const target = message.mentions.users.first() || message.author;
        try {
            const guildInvites = await message.guild.invites.fetch();
            const userInvites = guildInvites.filter(inv => inv.inviter && inv.inviter.id === target.id);
            let inviteCount = 0;
            userInvites.forEach(inv => inviteCount += inv.uses);

            const invEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
                .setDescription(`✅ You currently have **${inviteCount}** invites!`)
                .setTimestamp();

            return message.reply({ embeds: [invEmbed] });
        } catch (error) {
            console.error(error);
            return message.reply("Could not fetch invites.");
        }
    }

    // -- Giveaway Start Command --
    if (command === 'start') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
        
        const durationStr = args[0]; 
        const winnerCount = parseInt(args[1]);
        const prize = args.slice(2).join(' ');

        if (!durationStr || isNaN(winnerCount) || !prize) {
            return message.reply("⚠️ Usage: `!start <time><s/m/h/d> <winners_count> <prize>`\nExample: `!start 1d 3 Nitro`.");
        }

        const timeValue = parseInt(durationStr);
        const timeUnit = durationStr.slice(-1).toLowerCase();
        let durationMs = 0;

        switch (timeUnit) {
            case 's': durationMs = timeValue * 1000; break;
            case 'm': durationMs = timeValue * 60000; break;
            case 'h': durationMs = timeValue * 3600000; break;
            case 'd': durationMs = timeValue * 86400000; break;
            default: return message.reply("❌ Invalid time unit! Use (s, m, h, d).");
        }

        const endAt = Date.now() + durationMs;
        const endTimestamp = Math.floor(endAt / 1000);

        const embed = new EmbedBuilder()
            .setTitle('🎁 Giveaway Alert!')
            .setDescription(`**Prize:** ${prize}\n**Winners:** ${winnerCount}\n**Ends:** <t:${endTimestamp}:R>\n\nReact with 🎉 to enter!`)
            .setColor('#f1c40f')
            .setFooter({ text: `Drawing for ${winnerCount} winner(s)` })
            .setTimestamp();

        const giveawayMsg = await message.channel.send({ embeds: [embed] });
        await giveawayMsg.react('🎉');

        activeGiveaways.push({
            messageId: giveawayMsg.id,
            channelId: message.channel.id,
            endAt: endAt,
            winnerCount: winnerCount,
            prize: prize,
            ended: false
        });
        return;
    }

    // -- Moderation Commands --
    if (command === 'mute') {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const target = message.mentions.members.first();
      const duration = args[1]; 
      if (!target || !duration) return message.reply("Usage: `!mute @user <minutes>m`.");
      const minutes = parseInt(duration);
      await target.roles.add(MUTE_ROLE_ID).catch(() => {});
      message.channel.send(`🔒 ${target} has been muted for **${minutes}** minutes.`);
      setTimeout(() => { target.roles.remove(MUTE_ROLE_ID).catch(() => {}); }, minutes * 60 * 1000);
      return;
    }

    if (command === 'unmute') {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const target = message.mentions.members.first();
      if (!target) return;
      await target.roles.remove(MUTE_ROLE_ID).catch(() => {});
      message.channel.send(`🔓 ${target} has been unmuted.`);
      return;
    }

    if (command === 'clear' || command === 'purge') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
      const amount = parseInt(args[0]);
      if (isNaN(amount) || amount <= 0 || amount > 100) return message.reply("Provide a number between 1 and 100.");
      await message.delete(); 
      await message.channel.bulkDelete(amount, true);
      return;
    }
  }

  // --- [3] Mention Filter & Auto-Protection ---
  const currentGroup = PERMISSIONS_CONFIG.find(group => message.channel.id === group.channelId);
  if (currentGroup) {
    const mentionedRoles = message.mentions.roles;
    if (mentionedRoles.size > 0) {
      const hasAuthRole = message.member.roles.cache.has(currentGroup.userRoleId);
      const isCorrectMention = mentionedRoles.every(role => role.id === currentGroup.targetRoleId);
      if (!hasAuthRole || !isCorrectMention) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
          await message.delete().catch(() => {});
          const warnMsg = await message.channel.send(`⚠️ ${message.author}, in this channel you are only allowed to mention <@&${currentGroup.targetRoleId}>.`);
          setTimeout(() => warnMsg.delete().catch(() => {}));
          return;
        }
      }
    }
  }

  // --- Automod Logic ---
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const userId = message.author.id;
  const now = Date.now();
  if (!messageLog.has(userId)) messageLog.set(userId, []);
  const userData = messageLog.get(userId);
  userData.push({ timestamp: now, content: message.content });
  const recentMessages = userData.filter(msg => now - msg.timestamp < SPAM_INTERVAL);
  messageLog.set(userId, recentMessages);

  if (recentMessages.filter(msg => msg.content === message.content).length >= 3 || recentMessages.length >= SPAM_THRESHOLD) {
    if (await applyProgressiveMute(message, spamViolations, 'Anti-Spam', 'Please stop spamming!')) return;
  }
  if (NSFW_KEYWORDS.some(kw => message.content.toLowerCase().includes(kw))) {
    if (await applyProgressiveMute(message, nsfwViolations, 'NSFW Content', 'Inappropriate content is not allowed!')) return;
  }
  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    if (await applyProgressiveMute(message, linkViolations, 'External Links', 'Links are not allowed here!')) return;
  }
});

// --- Events: Join & Invites ---
client.on('inviteCreate', (invite) => {
  const guildInvites = invites.get(invite.guild.id);
  if (guildInvites) guildInvites.set(invite.code, invite.uses);
});

client.on('guildMemberAdd', async (member) => {
  try {
    const role = member.guild.roles.cache.get(AUTO_ROLE_ID);
    if (role) await member.roles.add(role);
  } catch (err) { console.error('Auto-role error:', err); }

  const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (!welcomeChannel) return;
  
  try {
    const newInvites = await member.guild.invites.fetch();
    const oldInvites = invites.get(member.guild.id);
    const invite = newInvites.find(i => i.uses > (oldInvites?.get(i.code) || 0));
    invites.set(member.guild.id, new Collection(newInvites.map(i => [i.code, i.uses])));
    
    welcomeChannel.send(invite 
      ? `Welcome ${member}! Joined using an invite from: <@${invite.inviter.id}>.` 
      : `Welcome ${member}!`);
  } catch (err) { console.error('Invite error:', err); }
});

client.login(DISCORD_BOT_TOKEN);
