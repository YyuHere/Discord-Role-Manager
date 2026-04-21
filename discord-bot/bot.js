import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection, ChannelType } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PREFIX = '!'; // يمكنك تغيير البريفكس هنا

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// --- [1] الإعدادات الأساسية ---
const AUTO_ROLE_ID = '1495910705172578364'; // ضع هنا أيدي الرتبة التلقائية للأعضاء الجدد
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

// إعدادات الحماية
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

client.once('ready', async () => {
  console.log(`Bot is online as ${client.user.tag}`);
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const guildInvites = await guild.invites.fetch();
      invites.set(guildId, new Collection(guildInvites.map((inv) => [inv.code, inv.uses])));
    } catch (err) { console.log(`Invite fetch error for guild: ${guildId}`); }
  }
});

// دالة تطبيق الكتم التلقائي (Progressive Mute)
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

  // --- [2] فلتر المنشن المخصص ---
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

  // --- [3] أوامر الإدارة اليدوية (Mute, Unmute, Clear) ---
  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // أمر الكتم
    if (command === 'mute') {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const target = message.mentions.members.first();
      const duration = args[1]; 
      if (!target || !duration || !duration.endsWith('m')) return;
      
      const minutes = parseInt(duration);
      await target.roles.add(MUTE_ROLE_ID).catch(() => {});
      message.channel.send(`🔒 ${target} has been muted for **${minutes}** minutes.`);
      
      setTimeout(() => { 
        target.roles.remove(MUTE_ROLE_ID).catch(() => {}); 
      }, minutes * 60 * 1000);
      return;
    }

    // أمر فك الكتم (تمت إعادته هنا)
    if (command === 'unmute') {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const target = message.mentions.members.first();
      if (!target) return;
      await target.roles.remove(MUTE_ROLE_ID).catch(() => {});
      message.channel.send(`🔓 ${target} has been unmuted.`);
      return;
    }

    // أمر المسح
    if (command === 'clear' || command === 'purge') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
      const amount = parseInt(args[0]);
      if (isNaN(amount) || amount <= 0 || amount > 100) return;
      await message.delete(); 
      await message.channel.bulkDelete(amount, true);
      return;
    }
  }

  // --- [4] الحماية التلقائية ---
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

// --- [5] نظام الرتبة التلقائية والترحيب وتتبع الدعوات ---
client.on('inviteCreate', (invite) => {
  const guildInvites = invites.get(invite.guild.id);
  if (guildInvites) guildInvites.set(invite.code, invite.uses);
});

client.on('guildMemberAdd', async (member) => {
  // أولاً: إعطاء الرتبة التلقائية فور دخول العضو
  try {
    const role = member.guild.roles.cache.get(AUTO_ROLE_ID);
    if (role) {
      await member.roles.add(role);
      console.log(`Auto-role assigned to ${member.user.tag}`);
    }
  } catch (err) {
    console.error('Failed to assign auto-role:', err);
  }

  // ثانياً: الترحيب وتتبع الدعوات
  const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (!welcomeChannel) return;
  
  try {
    const newInvites = await member.guild.invites.fetch();
    const oldInvites = invites.get(member.guild.id);
    const invite = newInvites.find(i => i.uses > (oldInvites?.get(i.code) || 0));
    
    invites.set(member.guild.id, new Collection(newInvites.map(i => [i.code, i.uses])));
    
    welcomeChannel.send(invite 
      ? `Welcome ${member}! Joined using invite from: <@${invite.inviter.id}>.` 
      : `Welcome ${member}!`);
  } catch (err) { 
    console.error('Error fetching invites on member join:', err); 
  }
});

client.login(DISCORD_BOT_TOKEN);
