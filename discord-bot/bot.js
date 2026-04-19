import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection, ChannelType } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PREFIX = ''; // يمكنك تغيير البريفكس من هنا

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

const MUTE_ROLE_ID = '1493775095028645969';
const WELCOME_CHANNEL_ID = '1495491723722494062';

// خريطة المنشن (كما هي في كودك)
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

// دالة لتحديث تصاريح الرتبة في كل القنوات
async function setupMuteRolePermissions(guild) {
  const muteRole = guild.roles.cache.get(MUTE_ROLE_ID);
  if (!muteRole) return;

  guild.channels.cache.forEach(async (channel) => {
    try {
      // منع الإرسال، إضافة التفاعلات، وإنشاء الخيوط
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
  // جلب الانفايتات عند التشغيل
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const guildInvites = await guild.invites.fetch();
      invites.set(guildId, new Collection(guildInvites.map((inv) => [inv.code, inv.uses])));
    } catch (err) {
      console.log(`Could not fetch invites for guild: ${guildId}`);
    }
  }
});

// دالة الميوت المتطور (للنظام التلقائي)
async function applyProgressiveMute(message, violationsMap, reason, warningText) {
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;

  await message.delete().catch(() => {});
  const userId = message.author.id;
  const violations = (violationsMap.get(userId) || 0) + 1;
  violationsMap.set(userId, violations);

  const muteIndex = Math.min(violations - 1, MUTE_DURATIONS_MINUTES.length - 1);
  const muteDuration = MUTE_DURATIONS_MINUTES[muteIndex];

  await message.member.roles.add(MUTE_ROLE_ID, reason).catch(() => {});
  
  const warning = await message.channel.send(`${message.author}, ${warningText} You have been muted for **${muteDuration}m**.`);
  
  setTimeout(() => {
    message.member.roles.remove(MUTE_ROLE_ID, 'Mute Expired').catch(() => {});
  }, muteDuration * 60 * 1000);

  setTimeout(() => warning.delete().catch(() => {}), 7000);
  return true;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // --- أوامر الميوت والفك اليدوية ---
  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // أمر الميوت: !mute @user 10m reason
    if (command === 'mute') {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;

      const target = message.mentions.members.first();
      const duration = args[1]; // مثال: 10m
      const reason = args.slice(2).join(' ') || 'No reason provided';

      if (!target) return message.reply('الرجاء منشن الشخص المراد إعطاؤه ميوت.');
      if (!duration || !duration.endsWith('m')) return message.reply('الرجاء تحديد الوقت بالدقائق، مثال: `!mute @user 10m`');

      const minutes = parseInt(duration);
      if (isNaN(minutes)) return message.reply('الوقت غير صالح.');

      await setupMuteRolePermissions(message.guild); // تحديث الرومات للتأكد من منع الرتبة
      await target.roles.add(MUTE_ROLE_ID).catch(e => message.reply("خطأ في إضافة الرتبة."));
      
      message.reply(`تم إعطاء ميوت لـ ${target.user.tag} لمدة ${minutes} دقيقة.`);

      setTimeout(() => {
        target.roles.remove(MUTE_ROLE_ID).catch(() => {});
      }, minutes * 60 * 1000);
      return;
    }

    // أمر فك الميوت: !unmute @user
    if (command === 'unmute') {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const target = message.mentions.members.first();
      if (!target) return message.reply('الرجاء منشن الشخص.');

      await target.roles.remove(MUTE_ROLE_ID).catch(e => message.reply("هذا الشخص لا يملك رتبة ميوت."));
      message.reply(`تم فك الميوت عن ${target.user.tag}.`);
      return;
    }
  }

  // --- نظام الحماية (السبام، الروابط، المنشن) ---
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
    if (await applyProgressiveMute(message, spamViolations, 'Anti-Spam', 'الرجاء التوقف عن التكرار!')) {
      messageLog.delete(userId);
      return;
    }
  }

  const contentLower = message.content.toLowerCase();
  if (NSFW_KEYWORDS.some(kw => contentLower.includes(kw))) {
    if (await applyProgressiveMute(message, nsfwViolations, 'NSFW Content', 'محتوى غير لائق!')) return;
  }

  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    if (await applyProgressiveMute(message, linkViolations, 'External Links', 'الروابط ممنوعة!')) return;
  }

  // فحص المنشن
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
      const warn = await message.channel.send(`${message.author}, لا يمكنك عمل منشن لهذه الرتبة هنا!`);
      setTimeout(() => warn.delete().catch(() => {}), 5000);
    }
  }
});

// باقي أكواد الانفايت والترحيب...
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
      welcomeChannel.send(`Welcome <@${member.id}>! تم دخول الشخص من طرف: <@${invite.inviter.id}>\nعدد دعواته الآن: **${invite.uses}**`);
    } else {
      welcomeChannel.send(`Welcome <@${member.id}>! انضم الشخص للسيرفر.`);
    }
  } catch (err) {
    console.error('Error tracking invite:', err);
  }
});

client.login(DISCORD_BOT_TOKEN);
