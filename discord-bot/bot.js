import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection, ChannelType, EmbedBuilder } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PREFIX = '!'; 

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

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

client.once('ready', async () => {
  console.log(`Bot is online as ${client.user.tag}`);
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
  setTimeout(() => warning.delete().catch(() => {}));
  return true;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // --- Giveaway Command ($50 / 30 Days) ---
    if (command === 'start') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
        
        // 30 days calculation
        const duration = 30 * 24 * 60 * 60 * 1000; 

        const embed = new EmbedBuilder()
            .setTitle('🎁 MEGA GIVEAWAY: $50 CASH!')
            .setDescription(`React with 🎉 to enter for a chance to win **$50**!\n\n**Time Remaining:** 30 Days\n**Condition:** You must be present in the server during the draw. If you leave, you are disqualified!`)
            .setColor('#2ecc71')
            .setFooter({ text: `Ends in 30 days` })
            .setTimestamp();

        const giveawayMsg = await message.channel.send({ embeds: [embed] });
        await giveawayMsg.react('🎉');

        const filter = (reaction, user) => reaction.emoji.name === '🎉' && !user.bot;
        const collector = giveawayMsg.createReactionCollector({ filter, time: duration });

        collector.on('end', async (collected) => {
            const reaction = collected.get('🎉');
            if (!reaction) return message.channel.send('Giveaway ended. No one participated.');

            const users = await reaction.users.fetch();
            const candidates = users.filter(u => !u.bot);
            const validWinners = [];

            for (const [id, user] of candidates) {
                try {
                    const isMember = await message.guild.members.fetch(id);
                    if (isMember) validWinners.push(isMember);
                } catch (e) {
                    // User is no longer in the guild
                }
            }

            if (validWinners.length === 0) return message.channel.send('Giveaway ended, but no valid participants were found in the server.');

            const winner = validWinners[Math.floor(Math.random() * validWinners.length)];
            message.channel.send(`🎊 Congratulations ${winner}! You won the **$50 Cash**! 🎊 Check your DMs for details.`);
        });
        return;
    }

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
            return message.reply("Could not fetch invites.");
        }
    }

    // --- Admin Commands ---
    if (command === 'mute') {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const target = message.mentions.members.first();
      const durationStr = args[1]; 
      if (!target || !durationStr || !durationStr.endsWith('m')) return;
      const minutes = parseInt(durationStr);
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
      if (isNaN(amount) || amount <= 0 || amount > 100) return;
      await message.delete(); 
      await message.channel.bulkDelete(amount, true);
      return;
    }
  }

  // --- Auto Protection & Mention Filter ---
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
          setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
          return;
        }
      }
    }
  }

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

// --- Invite Tracker & Welcome ---
client.on('inviteCreate', (invite) => {
  const guildInvites = invites.get(invite.guild.id);
  if (guildInvites) guildInvites.set(invite.code, invite.uses);
});

client.on('guildMemberAdd', async (member) => {
  try {
    const role = member.guild.roles.cache.get(AUTO_ROLE_ID);
    if (role) await member.roles.add(role);
  } catch (err) { console.error('Auto-role assignment error:', err); }

  const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (!welcomeChannel) return;
  
  try {
    const newInvites = await member.guild.invites.fetch();
    const oldInvites = invites.get(member.guild.id);
    const invite = newInvites.find(i => i.uses > (oldInvites?.get(i.code) || 0));
    invites.set(member.guild.id, new Collection(newInvites.map(i => [i.code, i.uses])));
    
    welcomeChannel.send(invite 
      ? `Welcome ${member}! Joined using invite code from: <@${invite.inviter.id}>.` 
      : `Welcome ${member}!`);
  } catch (err) { console.error('Invite fetch error on member join:', err); }
});

client.login(DISCORD_BOT_TOKEN);
