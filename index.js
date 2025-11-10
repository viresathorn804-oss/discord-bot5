// index.js
// Node.js + discord.js v14
// Features:
// - Slash: /แบน (ban many IDs/mentions), /ปลดแบน (unban many IDs)
// - Slash: /หมดเวลา (tempban id duration unit) -> stores to tempbans.json and auto-unban
// - Text commands: ?delete / ?clear <n>|all  (requires ManageMessages)
// - Text commands: ?เพิ่มยศ @user @role...  and ?ลบยศ @user @role... (requires ManageRoles)
// - Persists tempbans to tempbans.json so unbans survive restart (best-effort)

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, PermissionsBitField } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // ใส่ Application(Client) ID ถ้าต้องการ register commands ให้เร็ว (แนะนำ)
const GUILD_ID = process.env.GUILD_ID || ''; // ถ้าระบุ จะลงทะเบียนเป็น guild commands (เร็ว)
const PREFIX = process.env.PREFIX || '?';
const TEMP_FILE = path.join(__dirname, 'tempbans.json');

if (!TOKEN) {
  console.error('❌ ไม่มี TOKEN! โปรดตั้ง env var TOKEN');
  process.exit(1);
}

// -----------------------------
// helper: tempban persistence
// -----------------------------
let tempBans = []; // { guildId, userId, unbanAt }

function loadTempBans() {
  try {
    if (fs.existsSync(TEMP_FILE)) {
      const raw = fs.readFileSync(TEMP_FILE, 'utf8');
      tempBans = JSON.parse(raw);
      console.log('🔁 โหลด tempbans:', tempBans.length);
    } else {
      tempBans = [];
    }
  } catch (err) {
    console.error('❌ error load tempbans', err);
    tempBans = [];
  }
}

function saveTempBans() {
  try {
    fs.writeFileSync(TEMP_FILE, JSON.stringify(tempBans, null, 2));
  } catch (err) {
    console.error('❌ error save tempbans', err);
  }
}

function scheduleUnban(client, ban) {
  const delay = ban.unbanAt - Date.now();
  if (delay <= 0) {
    // time passed -> unban now
    doUnban(client, ban.guildId, ban.userId);
    tempBans = tempBans.filter(b => !(b.guildId === ban.guildId && b.userId === ban.userId));
    saveTempBans();
  } else {
    setTimeout(async () => {
      await doUnban(client, ban.guildId, ban.userId);
      tempBans = tempBans.filter(b => !(b.guildId === ban.guildId && b.userId === ban.userId));
      saveTempBans();
    }, delay);
  }
}

async function doUnban(client, guildId, userId) {
  try {
    const g = await client.guilds.fetch(guildId).catch(()=>null);
    if (!g) {
      console.warn(`⚠️ ไม่พบเซิร์ฟ ${guildId} ขณะปลดแบน ${userId}`);
      return;
    }
    await g.members.unban(userId);
    console.log(`✅ ปลดแบนอัตโนมัติ: ${userId} ใน guild ${guildId}`);
    // optional: send message to a mod-log channel (not implemented)
  } catch (err) {
    console.error(`❌ ไม่สามารถปลดแบน ${userId} ใน ${guildId}:`, err?.message || err);
  }
}

// -----------------------------
// discord client
// -----------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel],
});

// -----------------------------
// register slash commands
// -----------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('แบน')
    .setDescription('แบนผู้ใช้ตาม ID หรือ mention (คั่นด้วยช่องว่าง)')
    .addStringOption(opt => opt.setName('ids').setDescription('ระบุ ID หรือ mentions คั่นด้วยช่องว่าง').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('ปลดแบน')
    .setDescription('ปลดแบนตาม ID (คั่นด้วยช่องว่าง)')
    .addStringOption(opt => opt.setName('ids').setDescription('ระบุ ID คั่นด้วยช่องว่าง').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('หมดเวลา')
    .setDescription('แบนชั่วคราว: ระบุ ID/mention และระยะเวลา เช่น 10 m หรือ 2 h')
    .addStringOption(opt => opt.setName('id').setDescription('ID หรือ mention ของผู้ใช้').setRequired(true))
    .addIntegerOption(opt => opt.setName('value').setDescription('จำนวน (เช่น 10)').setRequired(true))
    .addStringOption(opt => opt.setName('unit').setDescription('หน่วย: m (minutes), h (hours), d (days)').setRequired(true))
    .toJSON()
];

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    if (CLIENT_ID && GUILD_ID) {
      console.log('🔁 ลงทะเบียนคำสั่งเป็น Guild commands...');
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log('✅ Guild commands registered');
    } else if (CLIENT_ID) {
      console.log('🔁 ลงทะเบียนเป็น Global commands (may take up to 1 hour)...');
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('✅ Global commands registered');
    } else {
      console.warn('⚠️ CLIENT_ID หรือ GUILD_ID ไม่ได้ตั้ง คำสั่งสแลชจะไม่ถูกลงทะเบียนอัตโนมัติ');
    }
  } catch (err) {
    console.error('❌ register commands failed:', err);
  }
}

// -----------------------------
// ready
// -----------------------------
client.once('ready', async () => {
  console.log(`✅ บอท ${client.user.tag} พร้อมทำงานแล้ว!`);
  // load tempbans and schedule
  loadTempBans();
  tempBans.forEach(b => scheduleUnban(client, b));
});

// -----------------------------
// messageCreate for prefix commands
// -----------------------------
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  // ?delete or ?clear
  if (cmd === 'delete' || cmd === 'clear') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return message.reply('❌ คุณไม่มีสิทธิ์จัดการข้อความ');
    }
    if (!args[0]) return message.reply('⚠️ โปรดระบุจำนวน เช่น `?delete 10` หรือ `?clear all`');

    if (args[0].toLowerCase() === 'all') {
      try {
        let total = 0;
        let fetched;
        do {
          fetched = await message.channel.messages.fetch({ limit: 100 });
          const deletable = fetched.filter(m => (Date.now() - m.createdTimestamp) < 14 * 24 * 60 * 60 * 1000);
          await message.channel.bulkDelete(deletable, true);
          total += deletable.size;
        } while (fetched.size === 100);
        return message.channel.send(`🧹 ลบข้อความทั้งหมดแล้ว (ประมาณ ${total} ข้อความ)`).then(m => setTimeout(()=>m.delete().catch(()=>{}),5000));
      } catch (err) {
        console.error(err);
        return message.reply('❌ เกิดข้อผิดพลาดขณะลบข้อความ');
      }
    } else {
      const n = parseInt(args[0]);
      if (isNaN(n) || n < 1 || n > 100) return message.reply('⚠️ ใส่ตัวเลข 1-100 เท่านั้น');
      try {
        await message.channel.bulkDelete(n, true);
        return message.channel.send(`✅ ลบข้อความ ${n} ข้อความแล้ว`).then(m => setTimeout(()=>m.delete().catch(()=>{}),5000));
      } catch (err) {
        console.error(err);
        return message.reply('❌ เกิดข้อผิดพลาดขณะลบข้อความ');
      }
    }
  }

  // ?เพิ่มยศ @user @role1 @role2 ...
  if (cmd === 'เพิ่มยศ' || cmd === 'give') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return message.reply('❌ คุณไม่มีสิทธิ์จัดการยศ');
    const member = message.mentions.members.first();
    const roles = message.mentions.roles;
    if (!member) return message.reply('❗ โปรดแท็กผู้ใช้');
    if (!roles || roles.size === 0) return message.reply('❗ โปรดแท็กยศที่ต้องการให้');
    for (const role of roles.values()) {
      try {
        await member.roles.add(role);
        await message.channel.send(`✅ เพิ่มยศ ${role.name} ให้ ${member.user.tag}`);
      } catch (err) {
        console.warn('role add error', err);
        await message.channel.send(`⚠️ ไม่สามารถเพิ่มยศ ${role.name} ให้ ${member.user.tag}`);
      }
    }
  }

  // ?ลบยศ @user @role1 ...
  if (cmd === 'ลบยศ' || cmd === 'removerole') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return message.reply('❌ คุณไม่มีสิทธิ์จัดการยศ');
    const member = message.mentions.members.first();
    const roles = message.mentions.roles;
    if (!member) return message.reply('❗ โปรดแท็กผู้ใช้');
    if (!roles || roles.size === 0) return message.reply('❗ โปรดแท็กยศที่ต้องการลบ');
    for (const role of roles.values()) {
      try {
        await member.roles.remove(role);
        await message.channel.send(`✅ ลบยศ ${role.name} จาก ${member.user.tag}`);
      } catch (err) {
        console.warn('role remove error', err);
        await message.channel.send(`⚠️ ไม่สามารถลบยศ ${role.name} จาก ${member.user.tag}`);
      }
    }
  }
});

// -----------------------------
// interactionCreate for slash commands
// -----------------------------
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  try {
    // /แบน ids: "id1 id2 ..."
    if (interaction.commandName === 'แบน') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return interaction.reply({ content: '❌ คุณไม่มีสิทธิ์แบนสมาชิก', ephemeral: true });
      }
      const raw = interaction.options.getString('ids');
      const ids = raw.split(/\s+/);
      const results = [];
      for (const rawId of ids) {
        const userId = rawId.replace(/[<@!>]/g,'');
        try {
          await interaction.guild.members.ban(userId, { reason: `แบนโดย ${interaction.user.tag}` });
          results.push(`✅ แบนแล้ว: <@${userId}> (${userId})`);
        } catch (err) {
          console.warn('ban err', err);
          results.push(`⚠️ ไม่สามารถแบน: ${rawId}`);
        }
      }
      await interaction.reply(results.join('\n'));
    }

    // /ปลดแบน ids
    if (interaction.commandName === 'ปลดแบน') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return interaction.reply({ content: '❌ คุณไม่มีสิทธิ์ปลดแบนสมาชิก', ephemeral: true });
      }
      const raw = interaction.options.getString('ids');
      const ids = raw.split(/\s+/);
      const results = [];
      for (const id of ids) {
        try {
          await interaction.guild.members.unban(id);
          results.push(`✅ ปลดแบนแล้ว: ${id}`);
        } catch (err) {
          console.warn('unban err', err);
          results.push(`⚠️ ไม่สามารถปลดแบน: ${id}`);
        }
      }
      await interaction.reply(results.join('\n'));
    }

    // /หมดเวลา id value unit
    if (interaction.commandName === 'หมดเวลา') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return interaction.reply({ content: '❌ คุณไม่มีสิทธิ์แบนสมาชิก', ephemeral: true });
      }
      const rawId = interaction.options.getString('id');
      const userId = rawId.replace(/[<@!>]/g,'');
      const value = interaction.options.getInteger('value');
      const unit = (interaction.options.getString('unit') || 'm').toLowerCase();

      let ms = 0;
      if (unit === 'm') ms = value * 60 * 1000;
      else if (unit === 'h') ms = value * 60 * 60 * 1000;
      else if (unit === 'd') ms = value * 24 * 60 * 60 * 1000;
      else return interaction.reply({ content: '❗ หน่วยไม่ถูกต้อง ใช้ m/h/d', ephemeral: true });

      const unbanAt = Date.now() + ms;
      try {
        await interaction.guild.members.ban(userId, { reason: `tempban by ${interaction.user.tag} for ${value}${unit}` });
        // save tempban
        tempBans.push({ guildId: interaction.guildId, userId, unbanAt });
        saveTempBans();
        scheduleUnban(client, { guildId: interaction.guildId, userId, unbanAt });

        return interaction.reply(`✅ แบนแล้ว: <@${userId}> เป็นเวลา ${value}${unit} (จะปลดแบนอัตโนมัติ)`);
      } catch (err) {
        console.error('tempban err', err);
        return interaction.reply({ content: `❌ ไม่สามารถแบน: ${userId}`, ephemeral: true });
      }
    }

  } catch (err) {
    console.error('interaction error', err);
    if (interaction.replied || interaction.deferred) return;
    try { await interaction.reply({ content: '❌ เกิดข้อผิดพลาด', ephemeral: true }); } catch {}
  }
});

// -----------------------------
// start
// -----------------------------
(async () => {
  await registerCommands().catch(()=>{});
  client.login(TOKEN);
})();
