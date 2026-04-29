// client.js — Криста 3.0 (исправленная версия)
const socket = io();

// ================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==================
let currentUser = null;
let currentRoomId = 'general';
let currentMessages = [];
let roomParticipants = [];
let recentSearches = JSON.parse(localStorage.getItem('kfr_recentSearches') || '[]');
let typingUsers = {};
let searchIndex = 0;
let searchResults = [];

// ================== DOM-ЭЛЕМЕНТЫ ==================
const authOverlay = document.getElementById('authOverlay');
const mainApp = document.getElementById('mainApp');
const authForm = document.getElementById('authForm');
const authLogin = document.getElementById('authLogin');
const authPassword = document.getElementById('authPassword');
const authNick = document.getElementById('authNick');
const registerNickField = document.getElementById('registerNickField');
const authSubmit = document.getElementById('authSubmit');
const authError = document.getElementById('authError');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');

const messagesContainer = document.getElementById('messagesContainer');
const chatTitle = document.getElementById('chatTitle');
const chatIdDisplay = document.getElementById('chatIdDisplay');
const messageInput = document.getElementById('messageInput');
const participantsList = document.getElementById('participantsList');
const subBtnContainer = document.getElementById('subBtnContainer');
const typingIndicator = document.getElementById('typingIndicator');
const searchBar = document.getElementById('searchBar');
const searchInput = document.getElementById('searchInput');
const emojiPicker = document.getElementById('emojiPicker');
const contextMenu = document.getElementById('contextMenu');
const reactionPicker = document.getElementById('reactionPicker');

// ================== АВТОРИЗАЦИЯ ==================
let authMode = 'login';
const savedToken = localStorage.getItem('kfr_token');
if (savedToken) {
  authOverlay.classList.add('hidden');
  mainApp.classList.remove('hidden');
  socket.emit('loginByToken', savedToken);
} else {
  authOverlay.classList.remove('hidden');
}

tabLogin.addEventListener('click', () => {
  authMode = 'login';
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  registerNickField.classList.add('hidden');
  authSubmit.textContent = 'Войти';
});
tabRegister.addEventListener('click', () => {
  authMode = 'register';
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerNickField.classList.remove('hidden');
  authSubmit.textContent = 'Зарегистрироваться';
});

authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const login = authLogin.value.trim();
  const password = authPassword.value;
  const nick = authNick.value.trim();
  authError.textContent = '';
  if (authMode === 'register') {
    socket.emit('register', { login, password, nick });
  } else {
    socket.emit('login', { login, password });
  }
});

socket.on('authError', (msg) => {
  authError.textContent = msg;
  authOverlay.classList.remove('hidden');
});

socket.on('authSuccess', (profile) => {
  currentUser = profile;
  localStorage.setItem('kfr_token', profile.token);
  authOverlay.classList.add('hidden');
  mainApp.classList.remove('hidden');
  applyUserSettings(profile);
  joinRoom('general');
});

socket.on('tokenLoginResult', (result) => {
  if (result.success) {
    currentUser = result.profile;
    applyUserSettings(result.profile);
    joinRoom('general');
  } else {
    localStorage.removeItem('kfr_token');
    authOverlay.classList.remove('hidden');
  }
});

// ================== ПРИМЕНЕНИЕ НАСТРОЕК ==================
function applyUserSettings(profile) {
  document.body.className = profile.theme === 'light' ? 'light' : '';
  document.getElementById('themeSelect').value = profile.theme;
  if (profile.background) {
    document.body.style.backgroundImage = `url(/backgrounds/${profile.background})`;
    document.body.style.backgroundSize = 'cover';
  } else {
    document.body.style.backgroundImage = '';
  }
  document.getElementById('inputNickname').value = profile.nick;
  document.getElementById('inputDescription').value = profile.description || '';
  document.getElementById('displayUserId').textContent = profile.id;
  if (profile.avatar) {
    document.getElementById('avatarPreview').src = `/avatars/${profile.avatar}`;
  } else {
    document.getElementById('avatarPreview').src = '';
  }
  renderColorPalette(profile.color);
}

// ================== КОМНАТЫ ==================
function joinRoom(roomId) {
  if (currentRoomId) socket.emit('leaveRoom', currentRoomId);
  currentRoomId = roomId;
  socket.emit('joinRoom', roomId);
}

socket.on('roomInfo', (info) => {
  currentMessages = info.messages || [];
  roomParticipants = info.participants || [];
  chatTitle.textContent = info.name;
  chatIdDisplay.textContent = `[${info.roomId}]`;
  renderMessages();
  renderParticipants();
  renderSubscriptionButton(info.roomId);
});

socket.on('userJoined', (user) => {
  if (!roomParticipants.find(p => p.id === user.id)) {
    roomParticipants.push({ ...user, online: true });
    renderParticipants();
  }
});

socket.on('userLeft', (userId) => {
  roomParticipants = roomParticipants.filter(p => p.id !== userId);
  renderParticipants();
});

socket.on('newMessage', (msg) => {
  addMessage(msg);
  if (document.hidden && msg.user !== 'System') {
    showNotification(`Новое сообщение от ${msg.user}`);
  }
});

socket.on('messageEdited', (data) => {
  const msg = currentMessages.find(m => m._id === data.messageId);
  if (msg) {
    msg.text = data.newText;
    msg.edited = true;
    renderMessages();
  }
});

socket.on('messageDeleted', (messageId) => {
  currentMessages = currentMessages.filter(m => m._id !== messageId);
  renderMessages();
});

socket.on('messageReaction', (data) => {
  const msg = currentMessages.find(m => m._id === data.messageId);
  if (msg) {
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[data.emoji]) msg.reactions[data.emoji] = [];
    if (!msg.reactions[data.emoji].includes(data.userId)) {
      msg.reactions[data.emoji].push(data.userId);
    }
    renderMessages();
  }
});

socket.on('typing', (data) => {
  if (data.userId !== currentUser?.id) {
    typingIndicator.textContent = `${data.nick} печатает...`;
    typingIndicator.classList.remove('hidden');
    clearTimeout(typingUsers[data.userId]);
    typingUsers[data.userId] = setTimeout(() => {
      typingIndicator.classList.add('hidden');
    }, 3000);
  }
});

socket.on('stopTyping', (data) => {
  clearTimeout(typingUsers[data.userId]);
  typingIndicator.classList.add('hidden');
});

socket.on('roomNameChanged', (newName) => {
  chatTitle.textContent = newName;
});

// ================== ОТРИСОВКА СООБЩЕНИЙ ==================
function renderMessages() {
  messagesContainer.innerHTML = '';
  if (!currentMessages.length) {
    messagesContainer.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">Нет сообщений</div>';
    return;
  }
  currentMessages.forEach(msg => appendMessage(msg));
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addMessage(msg) {
  currentMessages.push(msg);
  appendMessage(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = 'message' + (msg.user === 'System' ? ' system' : '');
  div.dataset.messageId = msg._id;

  let html = '';
  if (msg.time) html += `<span class="time">[${msg.time}]</span>`;
  if (msg.user) {
    html += `<span class="user" style="color:${msg.color || '#7aa2f7'}" data-user-id="${msg.userId}">${msg.user}:</span>`;
  }
  if (msg.replyTo) {
    const replyMsg = currentMessages.find(m => m._id === msg.replyTo);
    if (replyMsg) {
      html += `<div class="reply-preview">↪ ${replyMsg.user}: ${replyMsg.text.substring(0, 30)}</div>`;
    }
  }
  html += `<span class="text">${escapeHTML(msg.text)}${msg.edited ? ' (ред.)' : ''}</span>`;

  if (msg.reactions) {
    html += '<div class="reactions">';
    for (let [emoji, users] of Object.entries(msg.reactions)) {
      html += `<span class="reaction-badge">${emoji} ${users.length}</span>`;
    }
    html += '</div>';
  }

  div.innerHTML = html;

  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, msg);
  });

  const userSpan = div.querySelector('.user');
  if (userSpan && msg.userId) {
    userSpan.addEventListener('click', () => showProfile(msg.userId));
  }

  messagesContainer.appendChild(div);
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ================== КОНТЕКСТНОЕ МЕНЮ ==================
let selectedMessage = null;
function showContextMenu(x, y, msg) {
  selectedMessage = msg;
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.remove('hidden');
}

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) contextMenu.classList.add('hidden');
  if (!reactionPicker.contains(e.target)) reactionPicker.classList.add('hidden');
});

contextMenu.querySelector('[data-action="reply"]').addEventListener('click', () => {
  if (selectedMessage) startReply(selectedMessage);
  contextMenu.classList.add('hidden');
});

contextMenu.querySelector('[data-action="edit"]').addEventListener('click', () => {
  if (selectedMessage && selectedMessage.userId === currentUser.id) {
    const newText = prompt('Редактировать сообщение:', selectedMessage.text);
    if (newText && newText.trim() !== '') {
      socket.emit('editMessage', { roomId: currentRoomId, messageId: selectedMessage._id, newText: newText.trim() });
    }
  } else {
    alert('Можно редактировать только свои сообщения.');
  }
  contextMenu.classList.add('hidden');
});

contextMenu.querySelector('[data-action="delete"]').addEventListener('click', () => {
  if (selectedMessage && selectedMessage.userId === currentUser.id) {
    if (confirm('Удалить сообщение?')) {
      socket.emit('deleteMessage', { roomId: currentRoomId, messageId: selectedMessage._id });
    }
  } else {
    alert('Можно удалять только свои сообщения.');
  }
  contextMenu.classList.add('hidden');
});

contextMenu.querySelector('[data-action="react"]').addEventListener('click', () => {
  if (selectedMessage) showReactionPicker(contextMenu.offsetLeft, contextMenu.offsetTop - 50);
  contextMenu.classList.add('hidden');
});

contextMenu.querySelector('[data-action="copy"]').addEventListener('click', () => {
  if (selectedMessage) navigator.clipboard.writeText(selectedMessage.text);
  contextMenu.classList.add('hidden');
});

// ================== РЕАКЦИИ ==================
function showReactionPicker(x, y) {
  reactionPicker.style.left = x + 'px';
  reactionPicker.style.top = y + 'px';
  reactionPicker.classList.remove('hidden');
}

document.querySelectorAll('.reaction-emoji').forEach(emoji => {
  emoji.addEventListener('click', (e) => {
    const reaction = e.target.textContent;
    socket.emit('addReaction', { roomId: currentRoomId, messageId: selectedMessage._id, emoji: reaction });
    reactionPicker.classList.add('hidden');
  });
});

// ================== ОТВЕТ НА СООБЩЕНИЕ ==================
let replyTo = null;
function startReply(msg) {
  replyTo = msg;
  messageInput.placeholder = `Ответ на ${msg.user}: ${msg.text.substring(0, 20)}...`;
  messageInput.focus();
}

// ================== ОТПРАВКА СООБЩЕНИЙ ==================
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  const data = { roomId: currentRoomId, text };
  if (replyTo) {
    data.replyTo = replyTo._id;
    replyTo = null;
    messageInput.placeholder = 'Сообщение...';
  }
  socket.emit('chatMessage', data);
  messageInput.value = '';
  socket.emit('stopTyping', { roomId: currentRoomId });
}

document.getElementById('btnSend').addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

messageInput.addEventListener('input', () => {
  if (messageInput.value.trim() !== '') {
    socket.emit('typing', { roomId: currentRoomId });
  } else {
    socket.emit('stopTyping', { roomId: currentRoomId });
  }
});

// ================== ЭМОДЗИ ==================
const emojis = ['😀','😂','😍','🥰','😎','🤔','👍','❤️','🔥','🎉','👋','😢','😡','😱','🤗','🙏'];
emojiPicker.innerHTML = emojis.map(e => `<span>${e}</span>`).join('');
document.getElementById('emojiBtn').addEventListener('click', () => {
  emojiPicker.classList.toggle('hidden');
});
emojiPicker.addEventListener('click', (e) => {
  if (e.target.tagName === 'SPAN') {
    messageInput.value += e.target.textContent;
    emojiPicker.classList.add('hidden');
    messageInput.focus();
  }
});

// ================== ПОИСК ==================
document.getElementById('btnSearchToggle').addEventListener('click', () => {
  searchBar.classList.toggle('hidden');
  searchInput.focus();
});
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  searchResults = currentMessages.filter(m => m.text.toLowerCase().includes(query));
  searchIndex = 0;
  if (searchResults.length > 0) highlightMessage(searchResults[0]);
});
function highlightMessage(msg) {
  document.querySelectorAll('.message').forEach(el => el.style.background = '');
  const el = [...document.querySelectorAll('.message')].find(el => el.dataset.messageId === msg._id);
  if (el) {
    el.style.background = 'rgba(122,162,247,0.3)';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
document.getElementById('searchPrev').addEventListener('click', () => {
  if (searchResults.length === 0) return;
  searchIndex = (searchIndex - 1 + searchResults.length) % searchResults.length;
  highlightMessage(searchResults[searchIndex]);
});
document.getElementById('searchNext').addEventListener('click', () => {
  if (searchResults.length === 0) return;
  searchIndex = (searchIndex + 1) % searchResults.length;
  highlightMessage(searchResults[searchIndex]);
});
document.getElementById('closeSearch').addEventListener('click', () => {
  searchBar.classList.add('hidden');
  searchInput.value = '';
  searchResults = [];
  document.querySelectorAll('.message').forEach(el => el.style.background = '');
});

// ================== УЧАСТНИКИ ==================
function renderParticipants() {
  participantsList.innerHTML = '';
  roomParticipants.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="participant-info">
        <span class="online-dot ${p.online ? '' : 'offline-dot'}"></span>
        <span style="color:${p.color}">${p.nick}</span>
        <span style="color:#888;font-size:0.8rem;">[${p.id}]</span>
      </div>
    `;
    if (currentRoomId.startsWith('private_') && p.id !== currentUser.id) {
      const btn = document.createElement('button');
      btn.className = 'glass-btn-sm';
      btn.textContent = currentUser.blockedUsers?.includes(p.id) ? 'Разблокировать' : 'Заблокировать';
      btn.addEventListener('click', () => toggleBlock(p.id));
      li.appendChild(btn);
    }
    participantsList.appendChild(li);
  });
}

function toggleBlock(userId) {
  if (currentUser.blockedUsers?.includes(userId)) {
    socket.emit('unblockUser', userId);
  } else {
    socket.emit('blockUser', userId);
  }
}

// ================== ПОДПИСКА НА КОМНАТУ ==================
function renderSubscriptionButton(roomId) {
  subBtnContainer.innerHTML = '';
  if (roomId === 'general' || roomId.startsWith('private_')) return;
  const isSub = currentUser.subscribedRooms?.includes(roomId);
  const btn = document.createElement('button');
  btn.className = 'glass-btn-sm';
  btn.textContent = isSub ? 'Отписаться' : 'Подписаться';
  btn.addEventListener('click', () => {
    socket.emit(isSub ? 'unsubscribeRoom' : 'subscribeRoom', roomId);
  });
  subBtnContainer.appendChild(btn);
}

socket.on('subscribed', (roomId) => {
  if (roomId === currentRoomId) renderSubscriptionButton(roomId);
  if (!currentUser.subscribedRooms.includes(roomId)) currentUser.subscribedRooms.push(roomId);
});
socket.on('unsubscribed', (roomId) => {
  if (roomId === currentRoomId) renderSubscriptionButton(roomId);
  currentUser.subscribedRooms = currentUser.subscribedRooms.filter(r => r !== roomId);
});

// ================== ПРОФИЛЬ ==================
function showProfile(userId) {
  socket.emit('getUserProfile', userId);
}
socket.on('userProfile', (profile) => {
  const content = document.getElementById('profileContent');
  content.innerHTML = `
    <img src="${profile.avatar ? '/avatars/' + profile.avatar : 'https://via.placeholder.com/90'}" alt="Аватар">
    <div class="nick" style="color:${profile.color}">${profile.nick}</div>
    <div class="last-seen">Последний вход: ${new Date(profile.lastSeen).toLocaleString()}</div>
    <div class="description">${profile.description || ''}</div>
  `;
  document.getElementById('modalProfile').classList.remove('hidden');
});

// ================== ВЕРХНИЕ КНОПКИ ==================
document.getElementById('btnCreateRoom').addEventListener('click', () => {
  document.getElementById('modalCreateRoom').classList.remove('hidden');
});
document.getElementById('btnFind').addEventListener('click', () => {
  document.getElementById('modalFind').classList.remove('hidden');
  renderRecentSearches();
});
document.getElementById('btnDownload').addEventListener('click', downloadChat);
document.getElementById('btnSettings').addEventListener('click', () => {
  document.getElementById('modalSettings').classList.remove('hidden');
});
document.getElementById('btnList').addEventListener('click', () => {
  document.getElementById('modalList').classList.remove('hidden');
  renderChatList();
});

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const modal = document.getElementById(btn.dataset.modal);
    if (modal) modal.classList.add('hidden');
  });
});
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) e.target.classList.add('hidden');
});

// ================== СКАЧИВАНИЕ TXT ==================
function downloadChat() {
  if (!currentMessages.length) return alert('Нет сообщений');
  const BOM = '\uFEFF';
  let text = BOM + `Чат: ${chatTitle.textContent} ${chatIdDisplay.textContent}\n`;
  currentMessages.forEach(msg => {
    text += `[${msg.time}] ${msg.user}: ${msg.text}\n`;
  });
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `чат_${currentRoomId}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ================== ДОПОЛНИТЕЛЬНЫЕ ФУНКЦИИ ==================
function renderRecentSearches() {
  const list = document.getElementById('recentSearchesList');
  list.innerHTML = '';
  recentSearches.forEach(s => {
    const li = document.createElement('li');
    li.textContent = `${s.name} (ID: ${s.id})`;
    li.addEventListener('click', () => {
      document.getElementById('inputFindId').value = s.id;
    });
    list.appendChild(li);
  });
}

function renderChatList() {
  const roomsList = document.getElementById('roomsList');
  const contactsList = document.getElementById('contactsList');
  roomsList.innerHTML = '';
  contactsList.innerHTML = '';
  if (currentUser.subscribedRooms) {
    currentUser.subscribedRooms.forEach(id => {
      const li = document.createElement('li');
      li.textContent = `Чат [${id}]`;
      li.addEventListener('click', () => {
        joinRoom(id);
        document.getElementById('modalList').classList.add('hidden');
      });
      roomsList.appendChild(li);
    });
  }
  recentSearches.filter(s => !s.id.startsWith('6')).forEach(s => {
    const li = document.createElement('li');
    li.textContent = `${s.name || 'Пользователь'} [${s.id}]`;
    li.addEventListener('click', () => {
      socket.emit('startPrivateChat', s.id);
      document.getElementById('modalList').classList.add('hidden');
    });
    contactsList.appendChild(li);
  });
}

document.getElementById('btnCreateRoomSubmit').addEventListener('click', () => {
  const name = document.getElementById('inputRoomName').value.trim();
  if (!name) return alert('Введите название');
  socket.emit('createRoom', name);
  document.getElementById('modalCreateRoom').classList.add('hidden');
});
document.getElementById('btnFindSubmit').addEventListener('click', () => {
  const id = document.getElementById('inputFindId').value.trim();
  if (!id) return;
  if (id.startsWith('6')) {
    joinRoom(id);
  } else {
    socket.emit('startPrivateChat', id);
  }
  recentSearches.unshift({ id, name: id });
  if (recentSearches.length > 15) recentSearches.pop();
  localStorage.setItem('kfr_recentSearches', JSON.stringify(recentSearches));
  document.getElementById('modalFind').classList.add('hidden');
});

// ================== НАСТРОЙКИ ==================
const defaultColors = ['#7aa2f7','#f7768e','#9ece6a','#ff9e64','#bb9af7','#2ac3de','#e0af68','#f1fa8c'];
let selectedColor = currentUser?.color || '#7aa2f7';
function renderColorPalette(currentColor) {
  const palette = document.getElementById('colorPalette');
  palette.innerHTML = '';
  defaultColors.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (color === currentColor ? ' selected' : '');
    swatch.style.backgroundColor = color;
    swatch.addEventListener('click', () => {
      palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      selectedColor = color;
    });
    palette.appendChild(swatch);
  });
  selectedColor = currentColor;
}

document.getElementById('btnSaveProfile').addEventListener('click', () => {
  const nick = document.getElementById('inputNickname').value.trim();
  const description = document.getElementById('inputDescription').value.trim();
  const theme = document.getElementById('themeSelect').value;
  if (!nick) return alert('Никнейм обязателен');
  socket.emit('updateProfile', { nick, color: selectedColor, description, theme });
  document.getElementById('modalSettings').classList.add('hidden');
});

document.getElementById('avatarFile').addEventListener('change', async () => {
  const file = avatarFile.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('avatar', file);
  formData.append('userId', currentUser.id);
  const res = await fetch('/upload/avatar', { method: 'POST', body: formData });
  const data = await res.json();
  if (data.avatar) {
    currentUser.avatar = data.avatar;
    document.getElementById('avatarPreview').src = '/avatars/' + data.avatar;
  }
});
document.getElementById('bgFile').addEventListener('change', async () => {
  const file = bgFile.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('background', file);
  formData.append('userId', currentUser.id);
  const res = await fetch('/upload/background', { method: 'POST', body: formData });
  const data = await res.json();
  if (data.background) {
    currentUser.background = data.background;
    document.body.style.backgroundImage = `url(/backgrounds/${data.background})`;
    document.body.style.backgroundSize = 'cover';
  }
});

// ================== ПУШ-УВЕДОМЛЕНИЯ ==================
if (Notification.permission === 'default') {
  Notification.requestPermission();
}
function showNotification(text) {
  if (Notification.permission === 'granted') {
    new Notification('Криста 3.0', { body: text, icon: '/icons/icon-192.png' });
  }
}
