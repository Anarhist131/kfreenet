// server.js — Криста 3.0 Мессенджер (полный backend)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ========== Папки для загрузок ==========
['public/avatars', 'public/backgrounds'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

// ========== MULTER (аватарки и фоны) ==========
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = file.fieldname === 'avatar' ? 'public/avatars' : 'public/backgrounds';
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, req.body.userId + (file.fieldname === 'avatar' ? '_avatar' : '_bg') + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 } });

// ========== МОДЕЛИ MONGOOSE ==========
const profileSchema = new mongoose.Schema({
  id: String,
  login: { type: String, unique: true },
  passwordHash: String,
  token: String,            // токен для автовхода
  nick: String,
  color: { type: String, default: '#7aa2f7' },
  description: { type: String, default: '' },
  avatar: { type: String, default: '' },
  background: { type: String, default: '' },
  theme: { type: String, default: 'dark' },
  lastSeen: Date,
  blockedUsers: [String],
  subscribedRooms: [String]
});
const Profile = mongoose.model('Profile', profileSchema);

const roomSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: String,
  creator: String,
  admins: [String],
  participants: [String],
  messages: [{
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    time: String,
    user: String,
    userId: String,
    color: String,
    text: String,
    replyTo: String,
    edited: { type: Boolean, default: false },
    reactions: { type: Map, of: [String] } // эмодзи -> массив userId
  }]
});
const Room = mongoose.model('Room', roomSchema);

const counterSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  users: { type: Number, default: 0 },
  chats: { type: Number, default: 0 }
});
const Counter = mongoose.model('Counter', counterSchema);

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function getCurrentYYYYMM() {
  const d = new Date();
  return String(d.getFullYear()).slice(-2) + String(d.getMonth() + 1).padStart(2, '0');
}

async function generateUserId() {
  const key = getCurrentYYYYMM();
  const c = await Counter.findOneAndUpdate(
    { key }, { $inc: { users: 1 } }, { upsert: true, new: true }
  );
  return key + String(c.users).padStart(3, '0');
}

async function generateChatId() {
  const key = getCurrentYYYYMM();
  const c = await Counter.findOneAndUpdate(
    { key }, { $inc: { chats: 1 } }, { upsert: true, new: true }
  );
  return '6' + key + String(c.chats).padStart(3, '0');
}

function getCurrentTime() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(v => String(v).padStart(2, '0')).join(':');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function joinRoom(socket, roomId) {
  const room = await Room.findOne({ id: roomId });
  if (!room) return;
  const userId = socket.userId;
  if (!room.participants.includes(userId)) {
    room.participants.push(userId);
    await room.save();
  }
  socket.join(roomId);

  const participantsInfo = await Promise.all(room.participants.map(async id => {
    const p = await Profile.findOne({ id });
    return {
      id,
      nick: p ? p.nick : 'Unknown',
      color: p ? p.color : '#ccc',
      avatar: p ? p.avatar : '',
      online: isUserOnline(id)
    };
  }));

  socket.emit('roomInfo', {
    roomId,
    name: room.name,
    creator: room.creator,
    participants: participantsInfo,
    messages: room.messages.slice(-500)
  });

  const me = await Profile.findOne({ id: userId });
  socket.to(roomId).emit('userJoined', {
    id: userId,
    nick: me ? me.nick : 'Unknown',
    color: me ? me.color : '#7aa2f7',
    avatar: me ? me.avatar : ''
  });
}

function isUserOnline(userId) {
  for (let [, s] of io.sockets.sockets) {
    if (s.userId === userId) return true;
  }
  return false;
}

// ========== ЗАГРУЗКА ФАЙЛОВ ==========
app.post('/upload/avatar', upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  await Profile.findOneAndUpdate({ id: req.body.userId }, { avatar: req.file.filename });
  res.json({ avatar: req.file.filename });
});

app.post('/upload/background', upload.single('background'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  await Profile.findOneAndUpdate({ id: req.body.userId }, { background: req.file.filename });
  res.json({ background: req.file.filename });
});

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
  console.log('Новое соединение:', socket.id);

  // --- РЕГИСТРАЦИЯ ---
  socket.on('register', async (data) => {
    const { login, password, nick } = data;
    if (!login || !password) return socket.emit('authError', 'Логин и пароль обязательны');
    if (await Profile.findOne({ login })) return socket.emit('authError', 'Пользователь уже существует');
    const userId = await generateUserId();
    const hash = await bcrypt.hash(password, 10);
    const token = generateToken();
    const profile = await Profile.create({
      id: userId,
      login,
      passwordHash: hash,
      token,
      nick: nick || 'User' + userId,
      lastSeen: new Date()
    });
    socket.userId = userId;
    socket.emit('authSuccess', profile.toObject());
    joinRoom(socket, 'general');
  });

  // --- ВХОД ---
  socket.on('login', async (data) => {
    const { login, password } = data;
    const profile = await Profile.findOne({ login });
    if (!profile) return socket.emit('authError', 'Неверный логин или пароль');
    const valid = await bcrypt.compare(password, profile.passwordHash);
    if (!valid) return socket.emit('authError', 'Неверный логин или пароль');
    profile.token = generateToken();
    profile.lastSeen = new Date();
    await profile.save();
    socket.userId = profile.id;
    socket.emit('authSuccess', profile.toObject());
    joinRoom(socket, 'general');
  });

  // --- ВХОД ПО ТОКЕНУ ---
  socket.on('loginByToken', async (token) => {
    const profile = await Profile.findOne({ token });
    if (!profile) return socket.emit('tokenLoginResult', { success: false });
    profile.lastSeen = new Date();
    await profile.save();
    socket.userId = profile.id;
    socket.emit('tokenLoginResult', { success: true, profile: profile.toObject() });
    joinRoom(socket, 'general');
  });

  // --- ОБНОВЛЕНИЕ ПРОФИЛЯ ---
  socket.on('updateProfile', async (data) => {
    const userId = socket.userId;
    if (!userId) return;
    const updates = {};
    if (data.nick) updates.nick = data.nick.trim();
    if (data.color) updates.color = data.color;
    if (data.description !== undefined) updates.description = data.description;
    if (data.theme) updates.theme = data.theme;
    const profile = await Profile.findOneAndUpdate({ id: userId }, updates, { new: true });
    if (!profile) return;
    socket.emit('profileUpdated', profile.toObject());
    const rooms = await Room.find({ participants: userId });
    for (let room of rooms) {
      io.to(room.id).emit('userChanged', {
        userId,
        nick: profile.nick,
        color: profile.color,
        avatar: profile.avatar
      });
    }
  });

  // --- СОЗДАНИЕ КОМНАТЫ ---
  socket.on('createRoom', async (roomName) => {
    const userId = socket.userId;
    if (!userId || !roomName) return;
    const chatId = await generateChatId();
    const room = await Room.create({
      id: chatId,
      name: roomName,
      creator: userId,
      admins: [userId],
      participants: [userId],
      messages: [{
        time: getCurrentTime(),
        user: 'System',
        text: `Комната создана: ${chatId}. Команды: /namechat, /op, /Whatid`
      }]
    });
    socket.emit('roomCreated', { roomId: chatId, name: roomName });
    joinRoom(socket, chatId);
  });

  // --- ПРИСОЕДИНЕНИЕ К КОМНАТЕ ---
  socket.on('joinRoom', (roomId) => joinRoom(socket, roomId));

  // --- ПОКИНУТЬ КОМНАТУ ---
  socket.on('leaveRoom', async (roomId) => {
    const userId = socket.userId;
    const room = await Room.findOne({ id: roomId });
    if (!room) return;
    room.participants = room.participants.filter(id => id !== userId);
    await room.save();
    socket.leave(roomId);
    io.to(roomId).emit('userLeft', userId);
  });

  // --- ОТПРАВКА СООБЩЕНИЯ ---
  socket.on('chatMessage', async (data) => {
    const userId = socket.userId;
    const { roomId, text, replyTo } = data;
    if (!userId || !text) return;

    const profile = await Profile.findOne({ id: userId });
    const room = await Room.findOne({ id: roomId });
    if (!profile || !room) return;

    // Блокировка в личных чатах
    if (roomId.startsWith('private_')) {
      const ids = roomId.split('_').slice(1);
      const otherId = ids.find(id => id !== userId);
      if (otherId) {
        const other = await Profile.findOne({ id: otherId });
        if (other && other.blockedUsers.includes(userId)) {
          socket.emit('systemMessage', { roomId, text: 'Вы заблокированы.' });
          return;
        }
      }
    }

    // Команды
    if (text.startsWith('/')) {
      handleCommand(room, userId, text.trim(), socket);
      return;
    }

    const msg = {
      time: getCurrentTime(),
      user: profile.nick,
      userId,
      color: profile.color,
      text,
      replyTo: replyTo || null,
      reactions: {}
    };

    room.messages.push(msg);
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);
    await room.save();

    const savedMsg = room.messages[room.messages.length - 1];
    io.to(roomId).emit('newMessage', savedMsg.toObject());
  });

  // --- РЕДАКТИРОВАНИЕ ---
  socket.on('editMessage', async ({ roomId, messageId, newText }) => {
    const room = await Room.findOne({ id: roomId });
    if (!room) return;
    const msg = room.messages.id(messageId);
    if (!msg || msg.userId !== socket.userId) return;
    msg.text = newText;
    msg.edited = true;
    await room.save();
    io.to(roomId).emit('messageEdited', { messageId, newText });
  });

  // --- УДАЛЕНИЕ ---
  socket.on('deleteMessage', async ({ roomId, messageId }) => {
    const room = await Room.findOne({ id: roomId });
    if (!room) return;
    const msg = room.messages.id(messageId);
    if (!msg || msg.userId !== socket.userId) return;
    await room.updateOne({ $pull: { messages: { _id: messageId } } });
    io.to(roomId).emit('messageDeleted', messageId);
  });

  // --- РЕАКЦИИ ---
  socket.on('addReaction', async ({ roomId, messageId, emoji }) => {
    const room = await Room.findOne({ id: roomId });
    if (!room) return;
    const msg = room.messages.id(messageId);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    if (!msg.reactions[emoji].includes(socket.userId)) {
      msg.reactions[emoji].push(socket.userId);
    }
    await room.save();
    io.to(roomId).emit('messageReaction', { messageId, emoji, userId: socket.userId });
  });

  // --- ИНДИКАТОР ПЕЧАТИ ---
  socket.on('typing', ({ roomId }) => {
    const profile = Profile.findOne ? null : null; // быстро найти ник
    Profile.findOne({ id: socket.userId }).then(profile => {
      if (profile) socket.to(roomId).emit('typing', { userId: socket.userId, nick: profile.nick });
    });
  });
  socket.on('stopTyping', ({ roomId }) => {
    socket.to(roomId).emit('stopTyping', { userId: socket.userId });
  });

  // --- ЛИЧНЫЙ ЧАТ ---
  socket.on('startPrivateChat', async (targetId) => {
    const userId = socket.userId;
    if (!(await Profile.findOne({ id: targetId }))) {
      socket.emit('systemMessage', { roomId: 'global', text: 'Пользователь не найден.' });
      return;
    }
    const ids = [userId, targetId].sort();
    const roomId = 'private_' + ids[0] + '_' + ids[1];
    let room = await Room.findOne({ id: roomId });
    if (!room) {
      const p1 = await Profile.findOne({ id: ids[0] });
      const p2 = await Profile.findOne({ id: ids[1] });
      room = await Room.create({
        id: roomId,
        name: `Личный: ${p1.nick} / ${p2.nick}`,
        creator: 'system',
        participants: [ids[0], ids[1]],
        messages: []
      });
    }
    joinRoom(socket, roomId);
  });

  // --- ПОДПИСКА/ОТПИСКА ---
  socket.on('subscribeRoom', async (roomId) => {
    const userId = socket.userId;
    const profile = await Profile.findOne({ id: userId });
    if (!profile) return;
    if (!profile.subscribedRooms.includes(roomId)) {
      profile.subscribedRooms.push(roomId);
      await profile.save();
      const room = await Room.findOne({ id: roomId });
      if (room && !room.participants.includes(userId)) {
        room.participants.push(userId);
        await room.save();
      }
      socket.emit('subscribed', roomId);
    }
  });
  socket.on('unsubscribeRoom', async (roomId) => {
    const userId = socket.userId;
    const profile = await Profile.findOne({ id: userId });
    if (!profile) return;
    profile.subscribedRooms = profile.subscribedRooms.filter(r => r !== roomId);
    await profile.save();
    socket.emit('unsubscribed', roomId);
  });

  // --- БЛОКИРОВКА ---
  socket.on('blockUser', async (targetId) => {
    const userId = socket.userId;
    const profile = await Profile.findOne({ id: userId });
    if (!profile) return;
    if (!profile.blockedUsers.includes(targetId)) {
      profile.blockedUsers.push(targetId);
      await profile.save();
      socket.emit('userBlocked', targetId);
    }
  });
  socket.on('unblockUser', async (targetId) => {
    const userId = socket.userId;
    const profile = await Profile.findOne({ id: userId });
    if (!profile) return;
    profile.blockedUsers = profile.blockedUsers.filter(id => id !== targetId);
    await profile.save();
    socket.emit('userUnblocked', targetId);
  });

  // --- ЗАПРОС ПРОФИЛЯ ---
  socket.on('getUserProfile', async (userId) => {
    const profile = await Profile.findOne({ id: userId });
    if (profile) {
      socket.emit('userProfile', {
        nick: profile.nick,
        color: profile.color,
        avatar: profile.avatar,
        lastSeen: profile.lastSeen,
        description: profile.description
      });
    }
  });

  // --- ОТКЛЮЧЕНИЕ ---
  socket.on('disconnect', async () => {
    const userId = socket.userId;
    if (userId) {
      await Profile.findOneAndUpdate({ id: userId }, { lastSeen: new Date() });
    }
  });
});

// ========== ОБРАБОТКА КОМАНД ==========
async function handleCommand(room, userId, cmd, socket) {
  const parts = cmd.split(' ');
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  const sendSystem = async (text) => {
    const sysMsg = {
      time: getCurrentTime(),
      user: 'System',
      text,
      color: '#ffaa00'
    };
    io.to(room.id).emit('newMessage', sysMsg);
    room.messages.push(sysMsg);
    if (room.messages.length > 500) room.messages = room.messages.slice(-500);
    await room.save();
  };

  if (command === '/namechat') {
    if (!room.admins.includes(userId) && room.creator !== userId) {
      await sendSystem('Ошибка: Только администратор или создатель может менять название.');
      return;
    }
    const newName = args.trim();
    if (!newName) {
      await sendSystem('Использование: /namechat [Новое название]');
      return;
    }
    room.name = newName;
    await room.save();
    io.to(room.id).emit('roomNameChanged', newName);
    await sendSystem(`Название чата изменено на: ${newName}`);
  }
  else if (command === '/op') {
    if (room.creator !== userId) {
      await sendSystem('Ошибка: Только создатель может назначать администраторов.');
      return;
    }
    const targetNick = args.trim();
    if (!targetNick) {
      await sendSystem('Использование: /op [Никнейм]');
      return;
    }
    const targetUser = await Profile.findOne({ nick: targetNick, id: { $in: room.participants } });
    if (!targetUser) {
      await sendSystem(`Участник с ником ${targetNick} не найден в этом чате.`);
      return;
    }
    if (room.admins.includes(targetUser.id)) {
      await sendSystem(`${targetNick} уже администратор.`);
      return;
    }
    room.admins.push(targetUser.id);
    await room.save();
    await sendSystem(`${targetNick} теперь администратор.`);
  }
  else if (command === '/whatid') {
    const list = await Promise.all(room.participants.map(async p => {
      const profile = await Profile.findOne({ id: p });
      return `${profile ? profile.nick : 'Unknown'} [${p}]`;
    }));
    await sendSystem(`Чат: ${room.name} [${room.id}]\nУчастники: ${list.join(', ')}`);
  }
  else {
    await sendSystem('Неизвестная команда. Доступны: /namechat, /op, /Whatid');
  }
    }

// ========== ЗАПУСК ==========
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/krista';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB подключена');
    if (!(await Room.findOne({ id: 'general' }))) {
      await Room.create({
        id: 'general',
        name: 'Общий чат',
        creator: 'system',
        participants: [],
        messages: []
      });
      console.log('Общий чат создан');
    }
    server.listen(PORT, () => console.log(`Криста 3.0 запущена на порту ${PORT}`));
  })
  .catch(err => {
    console.error('Ошибка MongoDB:', err);
    process.exit(1);
  });
