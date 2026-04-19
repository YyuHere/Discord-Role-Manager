import { Client, GatewayIntentBits, Partials, PermissionFlagsBits, Collection } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  process.exit(1);
}

const invites = new Collection();
const spamTrack = new Map(); 
const spamViolations = new Map(); 
const linkViolations = new Map();
const nsfwViolations = new Map();

// إعدادات الرتب والقنوات
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

// دالة الميوت التلقائي
async function applyAutoMute(message, violationsMap, reason, warningText) {
  if (!message.member || message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;

  await message.delete().catch(() => {});
  const userId = message.author.id;
  const violations = (violationsMap.get(userId) || 0) + 1;
  violationsMap.set(userId, violations);

  const durations = [0, 5, 10, 30, 60];
  const muteDuration = durations[Math.min(violations - 1, durations.length - 1)];

  if (muteDuration > 0) {
    await message.member.roles.add(MUTE_ROLE_ID, reason).catch(() => {});
    setTimeout(() => {
      message.member.roles.remove(MUTE_ROLE_ID).catch(() => {});
    }, muteDuration * 60 * 1000);
    const msg = await message.channel.send(`${warningText} \u23F1 **${muteDuration}m**\n${message.author}`);
    setTimeout(() => msg.delete().catch(() => {}), 5000);
  } else {
    const msg = await message.channel.send(`${warningText}\n${message.author}`);
    setTimeout(() => msg.delete().catch(() => {}), 4000);
  }
  return true;
}

client.once('ready', async (c) => {
  console.log(`\u2705 Bot is online: ${c.user.tag}`);
  for (const [id, guild] of c.guilds.cache) {
    try {
      const gInvites = await guild.invites.fetch();
      invites.set(id, new Collection(gInvites.map(i => [i.code, i.uses])));
    } catch (err) {}
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    const newInvites = await member.guild.invites.fetch();
    const oldInvites = invites.get(member.guild.id);
    const invite = newInvites.find(i => i.uses > (oldInvites?.get(i.code) || 0));
    invites.set(member.guild.id, new Collection(newInvites.map(i => [i.code, i.uses])));
    
    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (channel) {
      const inviterText = invite ? `بواسطة: ${invite.inviter.username}` : "غير معروف";
      await channel.send(`\u2705 **${member.user.username}** انضم للسيرفر!\n\uD83D\uDC64 ${inviterText}`);
    }
  } catch (err) {}
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.member) return;

  // منع السبايم للأعضاء
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    const now = Date.now();
    const data = spamTrack.get(message.author.id) || { last: 0, count: 0 };
    if (now - data.last < 1000) data.count++;
    else data.count = 1;
    data.last = now;
    spamTrack.set(message.author.id, data);

    if (data.count >= 4) {
      return applyAutoMute(message, spamViolations, 'Spam', 'ممنوع التكرار!');
    }
  }

  // أمر الميوت اليدوي
  if (message.content.startsWith('!mmute')) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply("منشن الشخص.");
    await target.roles.add(MUTE_ROLE_ID).catch(() => {});
    return message.channel.send(`\uD83D\uDD12 تم إعطاء ميوت لـ ${target}`);
  }

  // أمر فك الميوت
  if (message.content.startsWith('!uunmute')) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const target = message.mentions.members.first();
    if (!target) return message.reply("منشن الشخص.");
    await target.roles.remove(MUTE_ROLE_ID).catch(() => {});
    return message.channel.send(`\uD83D\uDD13 تم فك الميوت عن ${target}`);
  }

  // أمر الدعوات
  if (message.content.startsWith('!invites')) {
    const target = message.mentions.members.first() || message.member;
    const gInvites = await message.guild.invites.fetch();
    const count = gInvites.filter(i => i.inviter?.id === target.id).reduce((a, b) => a + b.uses, 0);
    return message.reply(`\uD83D\uDCCA عدد دعواتك: **${count}**`);
  }

  // فلاتر الروابط والكلمات (الصور مسموحة عادي)
  const low = message.content.toLowerCase();
  if (NSFW_KEYWORDS.some(k => low.includes(k))) {
    return applyAutoMute(message, nsfwViolations, 'NSFW', 'ممنوع الكلمات الخارجة!');
  }
  if (URL_REGEX.test(message.content)) {
    URL_REGEX.lastIndex = 0;
    return applyAutoMute(message, linkViolations, 'Links', 'ممنوع الروابط!');
  }
});

client.login(DISCORD_BOT_TOKEN);
