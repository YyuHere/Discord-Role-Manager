import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// إعدادات القنوات والرواتب
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

// --- إعدادات الحماية من السبام ---
const spamViolations = new Map(); // لتتبع عدد مرات مخالفة السبام
const messageLog = new Map(); // لتتبع محتوى الرسائل وتوقيتها
const MUTE_DURATIONS_MINUTES = [5, 10, 30, 60, 1440]; // 5د، 10د، 30د، ساعة، يوم
const SPAM_THRESHOLD = 4; // عدد الرسائل المسموحة قبل الحذف
const SPAM_INTERVAL = 5000; // الفترة الزمنية (5 ثواني)

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

// دالة الميوت المتطور (المعدلة لتشمل زيادة المدة)
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

  // استثناء الإدارة من الفحص
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const userId = message.author.id;
  const now = Date.now();

  // --- نظام فحص السبام (التكرار والسرعة) ---
  if (!messageLog.has(userId)) {
    messageLog.set(userId, []);
  }

  const userData = messageLog.get(userId);
  userData.push({ timestamp: now, content: message.content });

  // تنظيف الرسائل القديمة من السجل (خارج نطاق الـ 5 ثواني)
  const recentMessages = userData.filter(msg => now - msg.timestamp < SPAM_INTERVAL);
  messageLog.set(userId, recentMessages);

  // 1. فحص تكرار نفس الرسالة
  const duplicateMessages = recentMessages.filter(msg => msg.content === message.content);
  
  // 2. فحص سرعة الإرسال (حتى لو كلام مختلف)
  if (duplicateMessages.length >= 3 || recentMessages.length >= SPAM_THRESHOLD) {
    if (await applyProgressiveMute(message, spamViolations, 'Anti-Spam', 'الرجاء التوقف عن التكرار/السبام!')) {
      messageLog.delete(userId); // تصغير السجل بعد العقوبة
      return;
    }
  }

  // --- فحص الرواتب والمنشن (الكود القديم الخاص بك) ---
  const contentLower = message.content.toLowerCase();
  if (NSFW_KEYWORDS.some(kw => contentLower.includes(kw))) {
    if (await applyProgressiveMute(message, nsfwViolations, 'NSFW Content', 'محتوى غير لائق!')) return;
  }

  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    if (await applyProgressiveMute(message, linkViolations, 'External Links', 'الروابط ممنوعة هنا!')) return;
  }

  // فحص المنشن العشوائي
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
      const warn = await message.channel.send(`${message.author}, لا يمكنك عمل منشن لهذه الرتبة في هذه القناة!`);
      setTimeout(() => warn.delete().catch(() => {}), 5000);
    }
  }
});

// (باقي كود الترحيب واللفلات كما هو دون تغيير)
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
